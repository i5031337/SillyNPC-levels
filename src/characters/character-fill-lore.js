import { loadWorldInfo } from '../../../../../world-info.js';
import { debugLog } from '../core/constants.js';
import { getSettings, saveSettings } from '../core/settings.js';
import { createLoreEntry, generateLoreContent, saveLoreContent } from '../api/api.js';
import { tryAutoSyncLorebook, ensureChatLorebookForFill } from '../lore/lorebook.js';
import { profileFieldValue, profileFieldsForCard } from '../core/profile-fields.js';
import { parseLoreContent, parseGeneratedProfileFields } from '../lore/lore-format.js';

/** The linked entry's text, or an empty string. Read fresh: it may have just been written. */
export async function readLoreEntry(char) {
    if (!char?.lorebook?.world) return '';
    try {
        const worldData = await loadWorldInfo(char.lorebook.world);
        const entries = worldData?.entries;
        const entry = Array.isArray(entries)
            ? entries.find(e => Number(e.uid) === Number(char.lorebook.uid))
            : entries?.[char.lorebook.uid];
        return entry?.content || '';
    } catch (err) {
        debugLog('Could not read the linked lore entry', err);
        return '';
    }
}

/**
 * Gives the card a lore entry: the one that already exists, or a new one.
 *
 * Reuses an existing entry. Fill keeps its additional lore intact while asking the model
 * to supply missing named details in the same request.
 *
 * @returns {Promise<{ ok: boolean, action: string, reason?: string }>}
 */
export async function fillLore(char) {
    // A Fill request in a chat with no chosen book gets its own lorebook before
    // auto-linking, so a stray global book is never silently made this chat's target.
    const target = char?.lorebook?.world || await ensureChatLorebookForFill();
    let existing = await readLoreEntry(char);

    if (!char.lorebook && await tryAutoSyncLorebook(char, { silent: true })) {
        existing = await readLoreEntry(char);
    }

    const scope = char.isPlayer ? 'player' : 'npc';
    const parsed = char.isPlayer ? parseGeneratedProfileFields(existing, scope) : parseLoreContent(existing);
    char.profile ||= {};
    let restored = false;
    for (const field of profileFieldsForCard(char)) {
        if (!String(profileFieldValue(char.profile, field)).trim() && parsed?.[field.id]) {
            char.profile[field.id] = parsed[field.id];
            restored = true;
        }
    }
    if (restored) saveSettings();
    const missing = profileFieldsForCard(char).some(field => !String(profileFieldValue(char.profile, field)).trim());
    if (parsed && !missing) {
        return { ok: true, action: 'linked entry is complete' };
    }

    const world = char.lorebook?.world || target;
    if (!world) {
        return {
            ok: false, action: 'none',
            reason: 'No chat is open, so Fill cannot create a chat lorebook.',
        };
    }

    /* No test on whether there is anything to write from.

       An entry is worth having for a character who has not appeared yet - that is most of
       what somebody is doing when they make a card in advance - and the lore writer reads
       the Data Bank and its own configurable slice of the chat, which is a different and
       larger question than "is this name in the last fifteen messages".

       The profile is the one that must not describe somebody it has never been told about;
       see fillSources. Applying the same test here refused far more than intended, because
       its Data Bank half is switched off by default. */
    // Creating an entry links it before generation starts. If generation failed on a
    // previous attempt, reuse that empty entry instead of treating the link as done.
    const uid = char.lorebook?.uid ?? (await createLoreEntry(char, world, char.name)).uid;
    const { content, tags } = await generateLoreContent(char, world, uid,
        { preserveLore: Boolean(parsed) });
    if (!String(content || '').trim()) {
        return { ok: false, action: 'none', reason: 'The lore writer returned nothing usable.' };
    }
    if (char.isPlayer && !parseGeneratedProfileFields(content, 'player')) {
        return { ok: false, action: 'none', reason: 'The lore writer did not return named player fields.' };
    }

    await saveLoreContent(char, world, uid, tags, content, { preserveEmpty: true });
    return { ok: true, action: `wrote a new entry in "${world}"` };
}
