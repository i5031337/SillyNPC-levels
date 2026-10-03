import { collectionAppliesTo } from '../core/collection-targets.js';
import { npcStatsFor } from '../core/npc-templates.js';
import { promptText } from '../prompts/prompt-texts.js';
import { chat } from '../../../../../../script.js';
import { executeSlashCommandsOnChatInput } from '../../../../../slash-commands.js';
import { LOG_PREFIX, debugLog } from '../core/constants.js';
import { profileFieldsForCard as fieldsForCard } from '../core/profile-fields.js';
import { applyMacros, modernisePlaceholders } from '../prompts/macros.js';
import { getSettings } from '../core/settings.js';
import { loadStateFromMetadata } from '../tracker/status-logic.js';
import { imageItemsFromCollections } from './api-image-items.js';

export { createLoreEntry } from '../lore/lore-entries.js';

/**
 * What the tracker already knows about this character, as lines for the lore prompt.
 *
 * The prompt used to see a name, whatever lore existed, and raw chat. Meanwhile the
 * extension was separately tracking this character's inventory, spells, skills and stats
 * and telling the model none of it - so generated lore re-inferred abilities from prose,
 * and contradicted the sheet it sits beside.
 *
 * Reads the scene first and falls back to the card, since a character who is not in the
 * room right now still has everything they own recorded there.
 *
 * @param {object} char The SillyNPC character card.
 * @returns {string} Empty when nothing is known, so the caller can substitute a note.
 */
/**
 * The character's profile fields, as lines for a prompt.
 *
 * Leads the established facts rather than sitting under them: who somebody is comes before
 * what they are currently carrying, and the lore writer is being told not to describe
 * these - which only works if it can see them.
 *
 * @param {object} char
 * @returns {string} Empty when nothing is filled in, so a caller can leave it out.
 */
export function describeProfile(char, except = null) {
    const profile = char?.profile || {};
    // A field being rewritten is left out. Showing the model the old personality under
    // "already known, do not contradict it" and then asking for a new one is asking it to
    // paraphrase what is already there, which is not what regenerating means.
    const skip = except instanceof Set ? except : new Set(except || []);
    return fieldsForCard(char)
        .filter(field => !skip.has(field.id))
        .map(field => {
            const value = String(profile[field.id] ?? '').trim();
            return value ? `${field.label}: ${value}` : null;
        })
        .filter(Boolean)
        .join('\n');
}

/**
 * The stats and collections a character actually has right now.
 *
 * The player is not one of the scene cast - that is what "this is me" means - so looking
 * them up by name in state.characters finds nothing, and both prompt builders quietly
 * fell back to the card's stored fields, which for the player are the master copy rather
 * than this chat. Their live facts are at state.player, and this is the one place that
 * says so.
 *
 * @param {object} char
 * Exported for the character page, which shows these and must not show the card's copy
 * for somebody currently on stage - those are what they last walked in carrying.
 *
 * @returns {{ stats: object, collections: object }}
 */
export function liveFactsFor(char) {
    let state = null;
    try { state = loadStateFromMetadata(); } catch { /* no chat open */ }

    if (char?.isPlayer) {
        return {
            stats: state?.player?.stats || char.stats || {},
            collections: state?.player?.collections || char.collections || {},
        };
    }

    const wanted = String(char?.name ?? '').toLowerCase();
    const actor = (state?.characters || []).find(c => String(c.name).toLowerCase() === wanted) || null;
    return {
        stats: Object.fromEntries(Object.entries(actor?.stats || char?.statusOverrides || {})
            .filter(([name]) => npcStatsFor(actor?.npcTemplateId ? actor : char, getSettings().statusTracker)
                .some(stat => stat.name.toLowerCase() === name.toLowerCase()))),
        collections: Object.fromEntries(Object.entries(actor?.collections || char?.statusCollections || {})
            .filter(([id]) => collectionAppliesTo(getSettings().statusTracker.collections?.find(col => col.id === id),
                'npc', actor?.npcTemplateId ? actor : char))),
    };
}

export function describeTrackedFacts(char, except = null) {
    if (!char?.name) return '';

    const { stats, collections } = liveFactsFor(char);
    const lines = [];

    // Who they are comes before what they are carrying. The exclusion is forwarded because
    // this is the second place a profile reaches the fill prompt, and leaving it out of only
    // the first would put the old value straight back in under another heading.
    const profile = describeProfile(char, except);
    if (profile) lines.push(profile);

    const statLine = Object.entries(stats)
        .filter(([, value]) => String(value ?? '').trim() !== '')
        .map(([name, value]) => `${name}: ${value}`)
        .join(', ');
    if (statLine) lines.push(statLine);

    for (const [colId, items] of Object.entries(collections)) {
        const named = (items || [])
            .map(item => {
                const name = String(item?.name ?? '').trim();
                if (!name) return null;
                // A one-line description is worth carrying; a paragraph is not.
                const detail = String(item?.description ?? '').trim().split('\n')[0];
                return detail && detail.length <= 120 ? `${name} (${detail})` : name;
            })
            .filter(Boolean);
        if (named.length) lines.push(`${colId}: ${named.join(', ')}`);
    }

    return lines.join('\n');
}

export function fillImagePrompt(template, { name, lore, items, context } = {}) {
    const own = { name, lore, items, context };
    let out = modernisePlaceholders(template, Object.keys(own));

    for (const [key, value] of Object.entries({ lore, items, context })) {
        if (value) continue;
        out = out.replace(new RegExp(`^[ \\t]*\\{\\{${key}\\}\\}[ \\t]*(?:\\r?\\n|$)`, 'gmi'), '');
        out = out.replace(new RegExp(`(?:[^\\n:]*:[^\\S\\n]*)?\\{\\{${key}\\}\\}`, 'gi'), '');
    }

    out = out.replace(/,[^\S\n]*(?=,|[^\S\n]*(?:\r?\n|$))/g, '');
    return applyMacros(out, {
        name: name || 'a character',
        lore: lore || '',
        items: items || '',
        context: context || '',
    }).trim();
}

export function describeCarriedItems(char) {
    if (!char?.name) return '';
    const { collections } = liveFactsFor(char);
    return imageItemsFromCollections(collections, getSettings().statusTracker.collections, char.isPlayer, char);
}

/** How much retrieved reference text the prompt will take. */
const WORLD_FACTS_CAP = 8000;

/**
 * What your Data Bank has to say about this character.
 *
 * SillyTavern's Vector Storage skips quiet prompts by design - `rearrangeChat` returns
 * immediately on type 'quiet' - so lore generation has never seen the Data Bank, before
 * or after it stopped using the story pipeline. This asks for it outright instead.
 *
 * Searched by name alone: predictable, and it finds the material that actually mentions
 * them rather than everything their inventory happens to resemble. No count argument, so
 * SillyTavern's own chunk-count setting decides and this does not compete with it.
 *
 * @param {string} name
 * @returns {Promise<string>} Empty when switched off, unavailable, or nothing matched.
 */
export async function retrieveWorldFacts(name) {
    if (!getSettings().loreUseDataBank) return '';

    // The parser splits on newlines and pipes and reads quotes, so a name carrying any of
    // them would take the rest of the command with it. Same treatment as the /sd prompt.
    const query = String(name ?? '')
        .replace(/\r?\n/g, ' ')
        .replace(/\|/g, ' ')
        .replace(/"/g, '\\"')
        .trim();
    if (!query) return '';

    try {
        const result = await executeSlashCommandsOnChatInput(
            `/db-search return=chunks ${query}`, { clearChatInput: false });
        const text = typeof result === 'string' ? result : (result?.pipe ?? '');
        const trimmed = String(text ?? '').trim();
        if (!trimmed) return '';

        debugLog('Data Bank chunks for lore', { name, chars: trimmed.length });
        // Chunk size is configurable, so three of them need not be small.
        return trimmed.length > WORLD_FACTS_CAP
            ? trimmed.slice(0, WORLD_FACTS_CAP)
            : trimmed;
    } catch (err) {
        // No index, no command, no Vector Storage. None of it should stop an entry being
        // written from what the extension already knows.
        console.warn(LOG_PREFIX, 'Data Bank search unavailable, writing without it', err);
        return '';
    }
}

/** What the lore writer is told it is, since it no longer inherits a character card. */
// The built-in wording; what is sent is promptText('loreSystem'), which may be your own.
