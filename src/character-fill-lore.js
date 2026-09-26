import { loadWorldInfo } from '../../../../world-info.js';
import { debugLog } from './constants.js';
import { getSettings } from './settings.js';
import { createLoreEntry, generateLoreContent, saveLoreContent } from './api.js';
import { tryAutoSyncLorebook, getChatLorebookName } from './lorebook.js';

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
 * Linking beats writing. A character named in a lorebook the user has curated by hand is
 * better described there than by anything generated, and writing a second entry for the
 * same person is how a lorebook fills up with duplicates.
 *
 * @returns {Promise<{ ok: boolean, action: string, reason?: string }>}
 */
export async function fillLore(char) {
    if (char.lorebook && String(await readLoreEntry(char)).trim()) {
        return { ok: true, action: 'already linked' };
    }

    if (!char.lorebook && await tryAutoSyncLorebook(char, { silent: true })) {
        if (String(await readLoreEntry(char)).trim()) {
            return { ok: true, action: 'linked an existing entry' };
        }
    }

    const world = char.lorebook?.world || getSettings().defaultLorebook || getChatLorebookName();
    if (!world) {
        return {
            ok: false, action: 'none',
            reason: 'No lorebook to write into. Choose a Default Target Lorebook in Generation, '
                + 'or open a chat that has one.',
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
    const { content, tags } = await generateLoreContent(char, world, uid);
    if (!String(content || '').trim()) {
        return { ok: false, action: 'none', reason: 'The lore writer returned nothing usable.' };
    }

    await saveLoreContent(char, world, uid, tags, content);
    return { ok: true, action: `wrote a new entry in "${world}"` };
}

