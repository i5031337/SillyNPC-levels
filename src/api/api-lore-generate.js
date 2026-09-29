import { promptText } from '../prompts/prompt-texts.js';
import { chat, extractMessageFromData } from '../../../../../../script.js';
import { getContext } from '../../../../../st-context.js';
import { loadWorldInfo, saveWorldInfo } from '../../../../../world-info.js';
import { LOG_PREFIX, debugLog } from '../core/constants.js';
import { fillTemplate } from '../prompts/macros.js';
import { getSettings, saveSettings } from '../core/settings.js';
import { DEFAULT_LORE_PROMPT } from '../prompts/default-prompt-texts.js';
import { recordUsage } from '../core/usage.js';
import { syncEntryIdentity, mergeKeywords, namesFor } from '../lore/lorebook.js';
import { escapeRegExp, describeConnection } from '../core/utils.js';
import { describeTrackedFacts, retrieveWorldFacts } from './api-lore-facts.js';
import { hintFor } from '../core/constants-profile.js';
import { resolveProfileFields } from '../core/profile-fields.js';
import { formatLoreContent, parseLoreContent, mergeLoreValues } from '../lore/lore-format.js';

/**
 * The slice of story the lore writer is shown.
 *
 * Bounded by characters as well as by message count. "Whole chat" meant literally the
 * whole chat: on a long story that is megabytes in a single prompt, and SillyTavern could
 * not build the request at all - it reported "Mandatory prompts exceed the context size",
 * then generated from whatever fitted, which was never the instruction.
 *
 * Whole messages only, newest first, so the excerpt never starts mid-sentence.
 *
 * @param {Array<object>} messages
 * @returns {{ text: string, used: number, available: number, trimmed: boolean }}
 */
export function buildLoreExcerpt(messages) {
    const settings = getSettings();
    // 0 means the whole chat, the same convention the history scan's depth uses. Read
    // with `|| 15` this would be silently impossible: zero is falsy, so choosing "whole
    // chat" would quietly have given fifteen messages.
    const configured = Number(settings.contextMessages);
    const count = Number.isFinite(configured) ? configured : 15;
    const wanted = count > 0 ? messages.slice(-count) : messages.slice();
    const budget = Math.max(1000, Number(settings.loreCharBudget) || 40000);

    const lines = [];
    let chars = 0;
    for (let i = wanted.length - 1; i >= 0; i--) {
        const m = wanted[i];
        const line = `${m.is_user ? 'User' : (m.name || 'Assistant')}: ${m.mes}`;
        if (chars + line.length > budget && lines.length) break;
        lines.unshift(line);
        chars += line.length + 1;
    }

    return {
        text: lines.join('\n'),
        used: lines.length,
        available: wanted.length,
        trimmed: lines.length < wanted.length,
    };
}

/**
 * Sends the lore request.
 *
 * Deliberately not generateQuietPrompt. That runs SillyTavern's story pipeline, so the
 * character card, your persona, world info and the chat all travel as *mandatory* prompts
 * with the instruction on top - and when they did not fit, SillyTavern dropped the
 * instruction, generated in character anyway, and offered that as lore.
 *
 * The same shape as requestExtraction: a chosen profile if there is one, otherwise
 * generateRawData, which sends only what it is given and works across backends.
 */
/**
 * Which connection served the last lore request, for the settings panel to display.
 *
 * A user reported that generating lore had changed the API their chat was using. It had
 * not - sendRequest passes a profile into one request and never writes selectedProfile -
 * but there was no way to establish that after the fact, only to reason about it. So
 * record what actually ran, including the fall back to the main API, which is the case
 * most likely to look like something went wrong.
 *
 * @type {{ label: string, when: number } | null}
 */
let lastLoreConnection = null;

/** @returns {{ label: string, when: number } | null} */
export function getLastLoreConnection() {
    return lastLoreConnection;
}

export async function requestLore(prompt) {
    const context = getContext();
    const settings = getSettings();
    const profileId = settings.loreProfileId;
    const maxTokens = Number(settings.loreMaxTokens) || 1200;

    debugLog(`Lore -> ${describeConnection(profileId)}, reply budget ${maxTokens}`);

    if (profileId) {
        // Connection Manager can be disabled and a profile can be deleted; either throws,
        // so fall through to the main API rather than failing the generation.
        try {
            const result = await context.ConnectionManagerRequestService.sendRequest(
                profileId,
                [
                    { role: 'system', content: promptText('loreSystem') },
                    { role: 'user', content: prompt },
                ],
                maxTokens,
                { extractData: true, includePreset: false },
            );
            const profile = context.extensionSettings?.connectionManager?.profiles
                ?.find(p => p.id === profileId);
            lastLoreConnection = {
                label: profile
                    ? `${profile.name || profileId}${profile.model ? ` (${profile.model})` : ''}`
                    : profileId,
                when: Date.now(),
            };
            const text = (typeof result === 'string' ? result : (result?.content ?? '')) || '';
            recordUsage('lore', { prompt: promptText('loreSystem') + prompt, reply: text });
            return text;
        } catch (err) {
            console.warn(LOG_PREFIX, 'Lore connection unavailable, using the main API:', err);
        }
    }

    lastLoreConnection = {
        label: profileId
            ? 'Main API (the chosen connection was unavailable)'
            : 'Main API (same as chat)',
        when: Date.now(),
    };
    const raw = await context.generateRawData({
        prompt,
        systemPrompt: promptText('loreSystem'),
        responseLength: maxTokens,
    });
    // generateRawData returns the provider's response object. Its text can live in
    // choices, results, or a content block array, depending on the main API.
    const text = extractMessageFromData(raw) || '';
    // Not awaited on purpose: counting asks the tokenizer, and a counter is not worth
    // making anyone wait for, nor worth failing a generation over.
    recordUsage('lore', { prompt: promptText('loreSystem') + prompt, reply: text });
    return text;
}

/**
 * Generates lore tags and content using an LLM.
 *
 * @param {object} char Character object
 * @param {string} world Lorebook name
 * @param {number} uid Entry UID
 * @param {object} [options]
 * @param {string} [options.template] A prompt to use instead of the character one - a
 *   location's lore is not a person's. Same placeholders, plus {{aliases}}.
 * @param {string|(() => string)} [options.facts] What is established, instead of the
 *   tracked stats a character has.
 * @returns {Promise<{ tags: string, content: string, followedFormat: boolean, excerpt: object }>}
 */
export async function generateLoreContent(char, world, uid, options = {}) {
    let existingLore = '';
    try {
        const worldData = await loadWorldInfo(world);
        const entries = worldData.entries;
        const entry = Array.isArray(entries) ? entries.find(e => Number(e.uid) === Number(uid)) : entries[uid];
        if (entry) existingLore = entry.content || '';
    } catch (e) {
        console.warn(LOG_PREFIX, 'Failed to load existing lore for generation', e);
    }

    const excerpt = buildLoreExcerpt(chat || []);
    const recentMessages = excerpt.text;
    const worldFacts = await retrieveWorldFacts(char.name);

    const template = options.template || DEFAULT_LORE_PROMPT;
    const givenFacts = typeof options.facts === 'function' ? options.facts() : options.facts;
    /* Both spellings and SillyTavern's own macros, in one pass. The old [TAG] form is
       rewritten to {{tag}} first rather than replaced separately, so a [NAME] that happens
       to be inside the chat excerpt or the existing entry is left alone - it is somebody's
       text, not a placeholder. */
    let prompt = fillTemplate(template, {
        name: char.name,
        lore: existingLore || '(No existing lore yet)',
        context: recentMessages,
        world: worldFacts || '(Nothing found in the Data Bank)',
        facts: (givenFacts !== undefined ? String(givenFacts ?? '').trim() : describeTrackedFacts(char))
            || '(Nothing tracked yet)',
        aliases: namesFor(char).slice(1).join(', ') || '(none)',
    });

    // A template written before [WORLD] existed - which is most of them, including any you
    // have customised - would otherwise leave the setting doing nothing at all. Appended
    // only when there is something to append, so an unindexed character gains no empty
    // heading.
    if (worldFacts && !/\[WORLD\]|{{\s*world\s*}}/i.test(template)) {
        prompt += `\n\nFrom the setting's reference material:\n${worldFacts}`;
    }

    if (!options.template && !char.isPlayer) {
        const existing = mergeLoreValues(existingLore, char.profile) || char.profile || {};
        prompt += '\n\nThe Content entry must contain every named field in the exact order shown. '
            + 'Write one labelled line per field and no unlabelled prose. '
            + 'Keep established values exactly as given; fill only blanks that the sources support. '
            + 'Never invent a value. This format replaces any older instruction above that omits '
            + 'these fields.\n'
            + resolveProfileFields('npc').map(field => `${field.label}: ${existing[field.id] || '(fill if known)'} — ${hintFor(field)}`)
                .join('\n');
        if (options.preserveLore && existingLore.trim()) {
            prompt += '\nThis is a Fill request. Keep all established field values exactly and fill only blanks.';
        }
    }

    const text = await requestLore(prompt);

    let tags = '';
    let content = text;

    const tagsMatch = text.match(/Tags:\s*([^\n\r]+)/i);
    const contentMatch = text.match(/Content:\s*([\s\S]+)/i);

    if (tagsMatch) {
        tags = tagsMatch[1].trim();
    }
    
    if (contentMatch) {
        content = contentMatch[1].trim();
    } else if (tagsMatch) {
        content = text.slice(tagsMatch.index + tagsMatch[0].length).trim();
    }
    
    if (tags) {
        const escapedTags = escapeRegExp(tags);
        const tagsPattern = new RegExp(`^\\s*Tags:\\s*${escapedTags}\\s*\\n?`, 'i');
        content = content.replace(tagsPattern, '').trim();
    }

    const namePattern = new RegExp(`^#*\\s*${escapeRegExp(char.name)}\\s*[:\\-]?\\s*\\n?`, 'i');
    content = content.replace(namePattern, '').trim();

    if (!options.template && !char.isPlayer) {
        const generated = parseLoreContent(content);
        if (generated) {
            const existing = mergeLoreValues(existingLore, char.profile) || char.profile || {};
            const values = Object.fromEntries(resolveProfileFields('npc').map(field => [field.id,
                String(options.preserveLore
                    ? (existing[field.id] || generated[field.id] || '')
                    : (generated[field.id] || existing[field.id] || '')).trim()]));
            content = formatLoreContent(values, existingLore);
        }
    }

    // The prompt asks for "Tags:" and "Content:". A reply with neither did not follow the
    // instruction, and the usual reason is that the instruction never arrived - the reply
    // is then the story model answering in character. Reported rather than hidden, so a
    // usable answer can still be salvaged.
    const followedFormat = Boolean(tagsMatch && contentMatch
        && (options.template || char.isPlayer || parseLoreContent(content)));

    return { tags, content, followedFormat, excerpt };
}


/**
 * Saves tags and content to a lorebook entry.
 * @param {object} char Character object
 * @param {string} world Lorebook name
 * @param {number} uid Entry UID
 * @param {string} tags Tags string
 * @param {string} content Lore content
 * @returns {Promise<void>}
 */
export async function saveLoreContent(char, world, uid, tags, content) {
    const worldData = await loadWorldInfo(world);
    if (!worldData || !worldData.entries) throw new Error('Lorebook not found or entries missing');
    
    const entries = worldData.entries;
    let entry;
    if (Array.isArray(entries)) {
        entry = entries.find(e => Number(e.uid) === Number(uid));
    } else {
        entry = entries[uid];
    }

    if (!entry) throw new Error(`Entry UID ${uid} not found in Lorebook`);

    entry.content = content.trim();
    if (!char.isPlayer) {
        const parsed = parseLoreContent(entry.content);
        if (!parsed) throw new Error('NPC lore must contain every named field in the required order.');
        entry.content = formatLoreContent(parsed, entry.content);
        char.profile = { ...char.profile, ...parsed };
    }
    // The writer returns Abilities/History/Ties and never a name, so the heading is put
    // on here rather than asked for. Before the tags merge, which must not be lost.
    syncEntryIdentity(char, entry);
    entry.key = mergeKeywords(entry.key, tags);
    
    await saveWorldInfo(world, worldData);
    char.lorebook = { world, uid: Number(uid) };
    saveSettings();
}
