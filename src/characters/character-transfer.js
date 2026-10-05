import { activeNpcSystem, npcTemplateFor, npcStatsFor } from '../core/npc-templates.js';
import { getSettings, saveSettings, normalizeSettings } from '../core/settings.js';
import { createCharacter, instantiateWorldCharacter } from './characters.js';
import { adoptImageForCharacter, createLoreEntry, saveLoreContent } from '../api/api.js';
import { tryAutoSyncLorebook, getChatLorebookName } from '../lore/lorebook.js';
import { loadWorldInfo } from '../../../../../world-info.js';
import { debugLog } from '../core/constants.js';
import { blankActiveProfile, profileStrings } from '../core/profile-fields.js';
import { splitNpcStats, initialiseNpcStats } from '../tracker/stat-persistence.js';
import { getAllCharacters, isChatCharacter } from './character-repository.js';

/** Transfer portable character prose, lore, and innate stats between installations.
 * Portraits are supplied by the recipient; older files with embedded portraits still import.
 */

export const TRANSFER_FORMAT = 'sillynpc-characters';
export const TRANSFER_VERSION = 2;

/* ─── Out ─────────────────────────────────────────────────────────────────── */

/** A character's lore entry as words rather than as a pointer, or null. */
async function readLoreEntry(char) {
    if (!char?.lorebook?.world) return null;
    try {
        const worldData = await loadWorldInfo(char.lorebook.world);
        const entries = worldData?.entries;
        const entry = Array.isArray(entries)
            ? entries.find(e => Number(e.uid) === Number(char.lorebook.uid))
            : entries?.[char.lorebook.uid];
        if (!entry || !String(entry.content ?? '').trim()) return null;
        return {
            keys: Array.isArray(entry.key) ? entry.key.map(String) : [],
            content: String(entry.content),
        };
    } catch (err) {
        debugLog('Could not read the lore entry for export', err);
        return null;
    }
}

/**
 * One character's identity, lore and carried values. Adventure state stays behind.
 *
 * @param {object} char
 * @returns {Promise<object>} The record.
 */
export async function serialiseCharacter(char, {
    npcStats = getSettings().statusTracker?.npcStats,
    system = activeNpcSystem(),
} = {}) {
    // A different System may have retired a field; exports must keep its prose.
    const profile = profileStrings(char.profile);

    return {
        name: String(char.name || ''),
        color: String(char.color || ''),
        category: String(char.category || ''),
        imageFit: String(char.imageFit || ''),
        aliases: Array.isArray(char.aliases) ? structuredClone(char.aliases) : [],
        profile,
        npcTemplateId: npcTemplateFor(char, system)?.id || char.npcTemplateId || '',
        // Keep the version 2 field name so existing character files remain readable.
        innateStats: splitNpcStats(char.statusOverrides, npcStats).innate,
        lore: await readLoreEntry(char),
    };
}

/**
 * The file, for one character or a selection of them.
 *
 * @param {object[]} chars
 * @returns {Promise<object>} The payload.
 */
export async function exportCharacters(chars, { npcStats } = {}) {
    const records = [];
    for (const char of chars) records.push(await serialiseCharacter(char, { npcStats }));

    return {
        format: TRANSFER_FORMAT,
        version: TRANSFER_VERSION,
        exported: new Date().toISOString(),
        characters: records,
    };
}

/* ─── In ──────────────────────────────────────────────────────────────────── */

/**
 * Reads a transfer file, refusing anything that is not one.
 *
 * Told apart from a whole-settings backup on purpose, and by name rather than by shape:
 * a backup also has a `characters` array, and importing one here would take a person's
 * whole collection and file it as a single character.
 *
 * @param {string} text
 * @returns {object} The payload.
 */
export function parseTransferFile(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('That file is not JSON.');
    }

    if (!data || typeof data !== 'object') throw new Error('That file is empty.');

    if (data.format !== TRANSFER_FORMAT) {
        throw new Error(Array.isArray(data.characters)
            ? 'That looks like a full settings backup rather than a character file. '
              + 'Import it from Advanced, which replaces everything rather than adding to it.'
            : 'That is not a SillyNPC character file.');
    }
    if (!Array.isArray(data.characters) || data.characters.length === 0) {
        throw new Error('That character file has nobody in it.');
    }
    if (Number(data.version) > TRANSFER_VERSION) {
        throw new Error(`That file was written by a newer version of SillyNPC (${data.version}).`);
    }

    return data;
}

/** A name nobody is using yet: "Vesper", then "Vesper (2)", "Vesper (3)". */
function freeName(wanted) {
    const taken = new Set(getAllCharacters()
        .map(c => String(c.name || '').toLowerCase()));
    if (!taken.has(wanted.toLowerCase())) return wanted;
    for (let n = 2; ; n++) {
        const candidate = `${wanted} (${n})`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}

/** Writes the record's fields onto a card, leaving its id and its place alone. */
function applyRecord(char, record, name, version) {
    char.name = name;
    char.color = String(record.color || char.color || '');
    char.imageFit = String(record.imageFit || '');
    char.npcTemplateId = String(record.npcTemplateId || '');
    char.aliases = Array.isArray(record.aliases) ? structuredClone(record.aliases) : [];
    // Version 1 mixed every override. The destination schema decides which values
    // travel; turn fields receive its defaults instead.
    const incoming = version >= 2 ? record.innateStats : record.statusOverrides;
    char.statusOverrides = initialiseNpcStats(incoming, npcStatsFor(char, getSettings().statusTracker));
    // Collections, conditions and inventory belong to the adventure instance.
    char.statusCollections = {};

    // Field by field, for the same reason normalizeSettings does it that way: a file
    // written before a field existed should gain it blank, not replace the set.
    char.profile = { ...blankActiveProfile(), ...Object.fromEntries(
        Object.entries(record.profile || {}).filter(([, value]) => typeof value === 'string')) };

    // The category name comes along; registering it is normalizeSettings' job, which the
    // import runs at the end. It already adopts any category a card names but the register
    // does not list, so creating it here would be the same work done twice.
    char.category = String(record.category || '');
}

/** Writes the inlined portraits back to disk and points the card at the right one. */
async function restoreImages(char, record) {
    char.images = [];
    char.imageUrl = '';

    const wanted = Number(record.portrait);
    const stored = [];
    for (const dataUri of Array.isArray(record.images) ? record.images : []) {
        if (typeof dataUri !== 'string' || !dataUri.startsWith('data:')) continue;
        // Writes the file, adds it to the list and points imageUrl at it - the same path a
        // portrait chosen from disk takes, so an imported one behaves like any other.
        stored.push(await adoptImageForCharacter(char, dataUri));
    }

    if (stored.length) {
        char.imageUrl = stored[wanted >= 0 && wanted < stored.length ? wanted : 0];
    }
}

/**
 * Gives the imported card its lore.
 *
 * An entry the recipient already keeps for this name wins, and the file's words are
 * dropped - the same rule fillLore follows, and for the same reason: a lorebook curated
 * by hand is better than anything arriving in a file, and writing a second entry for one
 * person is how a lorebook fills with duplicates.
 *
 * @returns {Promise<string>} What happened, for the report.
 */
async function restoreLore(char, record) {
    if (!record.lore || !String(record.lore.content || '').trim()) return '';

    if (await tryAutoSyncLorebook(char, { silent: true })) {
        return 'kept your existing lore entry';
    }

    const world = getSettings().defaultLorebook || getChatLorebookName();
    if (!world) return 'no lorebook to write the lore into';

    try {
        const { uid } = await createLoreEntry(char, world, char.name);
        await saveLoreContent(char, world, uid, (record.lore.keys || []).join(', '), record.lore.content);
        return `wrote its lore into "${world}"`;
    } catch (err) {
        debugLog('Could not write the imported lore entry', err);
        return 'could not write its lore entry';
    }
}

/**
 * Brings the characters in a file into the collection, alongside what is there.
 *
 * `onCollision` is asked what to do about a name already in use and answers 'rename',
 * 'overwrite' or 'skip'. With no handler the answer is rename: an import must not destroy
 * anything without being told to, and a duplicate can be deleted afterwards while an
 * overwritten character cannot be brought back.
 *
 * @param {object} payload From parseTransferFile.
 * @param {{ onCollision?: (name: string) => Promise<string> }} [options]
 * @returns {Promise<{ added: string[], overwritten: string[], skipped: string[], notes: string[] }>}
 */
export async function importCharacters(payload, { onCollision } = {}) {
    const result = { added: [], overwritten: [], skipped: [], notes: [] };
    const seenIncoming = new Set();

    for (const record of payload.characters) {
        const wanted = String(record?.name || '').trim();
        if (!wanted) { result.skipped.push('(unnamed)'); continue; }
        const repeatedInFile = seenIncoming.has(wanted.toLowerCase());
        seenIncoming.add(wanted.toLowerCase());

        const existing = getAllCharacters()
            .find(c => String(c.name || '').toLowerCase() === wanted.toLowerCase());

        let choice = 'rename';
        if (existing && !repeatedInFile) choice = onCollision ? await onCollision(wanted) : 'rename';
        if (existing && choice === 'skip') { result.skipped.push(wanted); continue; }

        // Two distinct source NPCs in one file must never overwrite one another merely
        // because they share a name, even when Replace Mine was chosen for local clashes.
        const overwriting = Boolean(existing) && !repeatedInFile && choice === 'overwrite';
        const localInstance = overwriting && !isChatCharacter(existing.id)
            ? instantiateWorldCharacter(existing.id) : null;

        // Named before the card exists, not after. createCharacter adds one under this
        // name straight away, so asking afterwards what names are free finds the card it
        // is about to name and renames around it - every import arrived as "(2)".
        const name = overwriting ? wanted : freeName(wanted);

        // Overwriting keeps the card that is already there - its id and its position -
        // and replaces what is on it. A fresh card would take the name while cast
        // decisions and anything else pointing at the old id kept pointing at a ghost.
        const char = localInstance || (overwriting ? existing : createCharacter(name));

        applyRecord(char, record, name, Number(payload.version) || 1);
        await restoreImages(char, record);
        const loreNote = await restoreLore(char, record);
        if (loreNote) result.notes.push(`${name}: ${loreNote}`);

        (overwriting && !localInstance ? result.overwritten : result.added).push(name);
    }

    // The same repair pass settings loaded at startup go through, for the same reason:
    // a file written by an older version is missing whatever has been added since.
    normalizeSettings(getSettings());
    saveSettings();
    return result;
}
