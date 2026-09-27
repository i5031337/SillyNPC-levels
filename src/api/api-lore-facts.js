import { promptText } from '../prompts/prompt-texts.js';
import { chat } from '../../../../../../script.js';
import { loadWorldInfo, saveWorldInfo, createWorldInfoEntry } from '../../../../../world-info.js';
import { executeSlashCommandsOnChatInput } from '../../../../../slash-commands.js';
import { LOG_PREFIX, debugLog, fieldsForCard } from '../core/constants.js';
import { applyMacros, modernisePlaceholders } from '../prompts/macros.js';
import { getSettings, saveSettings } from '../core/settings.js';
import { syncEntryIdentity } from '../lore/lorebook.js';
import { loadStateFromMetadata } from '../tracker/status-logic.js';

/**
 * Creates a new entry in a lorebook.
 * @param {object} char Character object
 * @param {string} targetWorld Lorebook name
 * @param {string} entryName Name for the entry
 * @returns {Promise<{world: string, uid: number}>}
 */
export async function createLoreEntry(char, targetWorld, entryName) {
    debugLog('Creating lore entry', { targetWorld, entryName });
    if (!targetWorld) throw new Error('No lorebook selected.');

    const worldData = await loadWorldInfo(targetWorld);
    if (!worldData || !worldData.entries) throw new Error(`Could not load lorebook "${targetWorld}".`);

    // SillyTavern's own constructor, rather than a hand-written object.
    //
    // A world-info entry carries 39 fields from the template. The version written here
    // set ten of them and
    // invented two that do not exist - `weight` and `recursive`, where the real fields
    // are `groupWeight` and excludeRecursion/preventRecursion - and set `depth` without
    // setting the `position` that gives depth its meaning. Everything now comes from
    // newWorldInfoEntryTemplate, and only the three fields we actually mean to fill are
    // touched afterwards.
    const entry = createWorldInfoEntry(targetWorld, worldData);
    if (!entry) throw new Error('SillyTavern could not allocate a new entry.');

    entry.content = '';
    // Title, keywords and - once there is a body to head - the heading that names whose
    // entry this is. entryName rather than char.name: a caller may be filing this under a
    // title of its own.
    syncEntryIdentity({ ...char, name: entryName }, entry);

    await saveWorldInfo(targetWorld, worldData);

    char.lorebook = { world: targetWorld, uid: entry.uid };
    saveSettings();

    return { world: targetWorld, uid: entry.uid };
}

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
        stats: actor?.stats || char?.statusOverrides || {},
        collections: actor?.collections || char?.statusCollections || {},
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

/**
 * Substitutes the portrait template's placeholders.
 *
 * Separate from the request so it can be checked without one. Name, lore and items each
 * get a readable stand-in rather than being dropped: an image model given "Carrying or
 * wearing:" with nothing after it will invent something to put there.
 *
 * Context is the exception, because it is the one a setting can deliberately turn off.
 * Image Context Length set to Lore Only means no recent chat was asked for, and writing
 * "Recent scene: (No recent context)" spends tokens saying nothing - Stable Diffusion in
 * particular reads those words as tags and draws them. So an empty context takes with it
 * whatever introduced it: the caption in front of it, and the comma holding it in a tag
 * list. The caption must not reach across a colon or a line break, or an empty context
 * would swallow the prompt above it.
 *
 * @param {string} template
 * @param {{ name?: string, lore?: string, items?: string, context?: string }} parts
 * @returns {string}
 */
export function fillImagePrompt(template, { name, lore, items, context } = {}) {
    const own = { name, lore, items, context };
    // Both spellings become one before anything is cut or substituted, so the cleanup
    // below has a single thing to look for.
    let out = modernisePlaceholders(template, Object.keys(own));

    if (!context) {
        // The caption introducing it, if there is one on the same line.
        out = out.replace(/(?:[^\n:]*:[^\S\n]*)?{{context}}/gi, '');
        // The comma holding it in a list, but only the one that now leads nowhere.
        out = out.replace(/,[^\S\n]*(?=,|[^\S\n]*(?:\r?\n|$))/g, '');
        // And the hole a whole removed line leaves in between two others.
        out = out.replace(/\n{3,}/g, '\n\n');
    }

    /* The stand-ins are the point of this function: a portrait prompt with a hole in it
       produces a picture of nothing in particular, so an absent value is replaced by
       something a model can draw rather than left blank. */
    return applyMacros(out, {
        name: name || 'a character',
        lore: lore || 'a mysterious person',
        items: items || 'nothing notable',
        context: context || '',
    });
}

/**
 * What this character is carrying, for a picture prompt.
 *
 * Deliberately not describeTrackedFacts: that carries stats and item descriptions, which
 * a portrait model does not want and Stable Diffusion in particular will render as
 * literal words. Names only, comma separated, in the order they are held.
 *
 * @param {object} char
 * @returns {string} Empty when nothing is recorded, so the caller can substitute.
 */
export function describeCarriedItems(char) {
    if (!char?.name) return '';

    const { collections } = liveFactsFor(char);
    const names = [];
    const seen = new Set();

    for (const items of Object.values(collections)) {
        for (const item of items || []) {
            const name = String(item?.name ?? '').trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            names.push(name);
        }
    }

    return names.join(', ');
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
