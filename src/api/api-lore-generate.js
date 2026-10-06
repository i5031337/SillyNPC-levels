import { promptText } from '../prompts/prompt-texts.js';
import { chat, extractMessageFromData } from '../../../../../../script.js';
import { getContext } from '../../../../../st-context.js';
import { loadWorldInfo, saveWorldInfo } from '../../../../../world-info.js';
import { LOG_PREFIX, debugLog } from '../core/constants.js';
import { fillTemplate } from '../prompts/macros.js';
import { getSettings, saveSettings } from '../core/settings.js';
import { DEFAULT_LORE_PROMPT } from '../prompts/default-prompt-texts.js';
import { recordUsage } from '../core/usage.js';
import { customProfilePayload } from './api-connection-profile.js';
import { syncEntryIdentity, mergeKeywords, namesFor } from '../lore/lorebook.js';
import { escapeRegExp, describeConnection } from '../core/utils.js';
import { describeTrackedFacts, retrieveWorldFacts } from './api-lore-facts.js';
import { hintFor } from '../core/constants-profile.js';
import { profileFieldsForCard } from '../core/profile-fields.js';
import { formatLoreContent, parseLoreContent, parseGeneratedProfileFields, mergeLoreValues } from '../lore/lore-format.js';
import { loreReplyWasTruncated, parseLoreReply } from '../lore/lore-reply.js';

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
                { extractData: false, includePreset: false },
                customProfilePayload(context, profileId),
            );
            const profile = context.extensionSettings?.connectionManager?.profiles
                ?.find(p => p.id === profileId);
            lastLoreConnection = {
                label: profile
                    ? `${profile.name || profileId}${profile.model ? ` (${profile.model})` : ''}`
                    : profileId,
                when: Date.now(),
            };
            const api = context.ConnectionManagerRequestService.validateProfile(profile).selected;
            const text = extractMessageFromData(result, api) || '';
            recordUsage('lore', { prompt: promptText('loreSystem') + prompt, reply: text });
            return { text, truncated: loreReplyWasTruncated(result) };
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
    return { text, truncated: loreReplyWasTruncated(raw) };
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
 * @returns {Promise<{ tags: string, content: string, followedFormat: boolean, truncated: boolean, excerpt: object }>}
 */
export async function generateLoreContent(char, world, uid, options = {}) {
    let existingLore = '';
    if (world) try {
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
    const established = char.isPlayer ? (char.profile || {})
        : (mergeLoreValues(existingLore, char.profile) || char.profile || {});
    const fields = profileFieldsForCard(char);
    const profileFields = fields.map(field =>
        `- ${field.label}: ${hintFor(field)}${established[field.id]
            ? ` (established: ${String(established[field.id]).trim()})` : ''}`).join('\n');
    const profileTemplate = fields.map(field => {
        const guidance = hintFor(field).trim() || 'Brief supported value.';
        const known = String(established[field.id] ?? '').replace(/\s+/g, ' ').trim();
        return `  ${field.label}: <${guidance}${known ? ` Established: ${known}` : ''}>`;
    }).join('\n');
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
        profileFields,
        profileTemplate,
    });

    // A template written before [WORLD] existed - which is most of them, including any you
    // have customised - would otherwise leave the setting doing nothing at all. Appended
    // only when there is something to append, so an unindexed character gains no empty
    // heading.
    if (worldFacts && !/\[WORLD\]|{{\s*world\s*}}/i.test(template)) {
        prompt += `\n\nFrom the setting's reference material:\n${worldFacts}`;
    }

    const { text, truncated } = await requestLore(prompt);

    let { tags, content, followedSections } = parseLoreReply(text,
        !options.template ? profileFieldsForCard(char) : []);

    const namePattern = new RegExp(`^#*\\s*${escapeRegExp(char.name)}\\s*[:\\-]?\\s*\\n?`, 'i');
    content = content.replace(namePattern, '').trim();

    if (!options.template && !char.isPlayer) {
        const generated = parseLoreContent(content, { allowPartial: true });
        if (generated) {
            content = profileFieldsForCard(char)
                .filter(field => Object.hasOwn(generated, field.id))
                .map(field => `${field.label}: ${String(options.preserveLore
                    ? (established[field.id] || generated[field.id] || '')
                    : (generated[field.id] || established[field.id] || '')).trim()}`)
                .join('\n');
        }
    }

    // The prompt asks for tags and content in a small YAML envelope. A reply without it did not follow the
    // instruction, and the usual reason is that the instruction never arrived - the reply
    // is then the story model answering in character. Reported rather than hidden, so a
    // usable answer can still be salvaged.
    const followedFormat = Boolean(followedSections
        && (options.template || parseGeneratedProfileFields(content, char.isPlayer ? 'player' : 'npc')));

    return { tags, content, followedFormat, truncated, excerpt };
}


/**
 * Saves tags and content to a lorebook entry.
 * @param {object} char Character object
 * @param {string} world Lorebook name
 * @param {number} uid Entry UID
 * @param {string} tags Tags string
 * @param {string} content Lore content
 * @param {{ preserveEmpty?: boolean }} [options]
 * @returns {Promise<{ profileFieldsSaved: number }>}
 */
export async function saveLoreContent(char, world, uid, tags, content, { preserveEmpty = false } = {}) {
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

    const submitted = String(content ?? '').trim();
    let profile = char.profile;
    let profileFieldsSaved = 0;
    if (char.isPlayer) {
        const parsed = parseGeneratedProfileFields(submitted, 'player');
        if (parsed) {
            const values = preserveEmpty ? Object.fromEntries(Object.entries(parsed).filter(([, value]) => value)) : parsed;
            profile = { ...profile, ...values };
            profileFieldsSaved = Object.values(values).filter(Boolean).length;
            const existing = preserveEmpty ? mergeLoreValues(entry.content, char.profile, 'player') || char.profile || {} : {};
            entry.content = formatLoreContent({ ...existing, ...values },
                preserveEmpty ? entry.content : '', undefined, 'player');
        } else {
            entry.content = submitted;
        }
    } else if (!profileFieldsForCard(char).length) {
        entry.content = submitted;
    } else {
        const parsed = parseGeneratedProfileFields(submitted, 'npc');
        if (!parsed) throw new Error('NPC lore must use named fields in the required order.');
        const selectedIds = new Set(profileFieldsForCard(char).map(field => field.id));
        const accepted = Object.fromEntries(Object.entries(parsed).filter(([id, value]) => selectedIds.has(id) && (!preserveEmpty || value)));
        const complete = Object.keys(accepted).length === profileFieldsForCard(char).length;
        const values = complete ? accepted : { ...(mergeLoreValues(entry.content, profile) || profile || {}), ...accepted };
        entry.content = formatLoreContent(values, entry.content, undefined, 'npc', profileFieldsForCard(char));
        profile = { ...profile, ...accepted };
        profileFieldsSaved = Object.values(accepted).filter(Boolean).length;
    }
    // The writer returns Abilities/History/Ties and never a name, so the heading is put
    // on here rather than asked for. Before the tags merge, which must not be lost.
    syncEntryIdentity(char, entry);
    entry.key = mergeKeywords(entry.key, tags);
    
    await saveWorldInfo(world, worldData);
    char.profile = profile;
    char.lorebook = { world, uid: Number(uid) };
    saveSettings();
    return { profileFieldsSaved };
}
