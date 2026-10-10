import { npcStatsFor } from '../core/npc-templates.js';
import { fieldAppliesTo } from '../core/system-fields.js';
import { getSettings, saveSettings } from '../core/settings.js';
import { getLibraryCharacters } from '../characters/character-repository.js';
import { escapeRegExp } from '../core/utils.js';

export function bind(deps) {
const STAT_SCOPES = ['globalStats', 'playerStats', 'npcStats'];

/** Moves one key of an object, keeping its position. @returns {boolean} whether it moved */
function moveKey(holder, oldName, newName) {
    if (!holder || typeof holder !== 'object' || !Object.hasOwn(holder, oldName)) return false;

    // The same collapse rule the collections use: if both keys are present, the one the
    // schema still knows about is the newer and is kept.
    const occupied = holder[newName] !== undefined && holder[newName] !== '' && holder[newName] !== null;
    const keep = occupied ? holder[newName] : holder[oldName];

    const entries = Object.entries(holder);
    for (const key of Object.keys(holder)) delete holder[key];
    let written = false;
    for (const [key, value] of entries) {
        if (key === oldName || key === newName) {
            if (!written) { holder[newName] = keep; written = true; }
        } else {
            holder[key] = value;
        }
    }
    return true;
}

/** Filter values through the active schema without deleting archived stat history. */
function statsInSystem(stored, listKey, actor) {
    if (!stored || typeof stored !== 'object') return {};
    const declared = new Set(
        (listKey === 'npcStats' && actor ? npcStatsFor(actor, getSettings().statusTracker)
            : getSettings().statusTracker?.[listKey] || [])
            .map(stat => String(stat?.name ?? '').trim().toLowerCase())
            .filter(Boolean));

    const out = {};
    for (const [key, value] of Object.entries(stored)) {
        if (declared.has(String(key).trim().toLowerCase())) out[key] = value;
    }
    return out;
}

/** Rename held stat values; update unambiguous display references. */
function renameStat(listKey, oldName, newName, field) {
    const empty = { values: 0, templateUpdated: false, cssMentions: false };
    if (!STAT_SCOPES.includes(listKey) || !oldName || !newName || oldName === newName) return empty;

    const settings = getSettings();
    const tracker = settings.statusTracker;
    let values = 0;

    const state = deps.committedState || deps.loadStateFromMetadata();

    if (listKey === 'globalStats' && state) {
        if (moveKey(state.global, oldName, newName)) values += 1;
    }

    if (listKey === 'playerStats') {
        if (state && moveKey(state.player?.stats, oldName, newName)) values += 1;
        for (const player of Object.values(state?.players || {})) {
            if (moveKey(player?.stats, oldName, newName)) values += 1;
        }
        // Every persona, not just the active one: the others are not loaded now but are
        // the same player returning to a different chat.
        for (const persona of Object.values(settings.personaData || {})) {
            if (moveKey(persona?.stats, oldName, newName)) values += 1;
        }
    }

    if (listKey === 'npcStats') {
        const system = tracker.presets?.[settings.activeSystem]?.definition;
        const applies = actor => !field || fieldAppliesTo(field, 'npc', actor, system);
        for (const actor of (state?.characters || [])) {
            if (!applies(actor)) continue;
            if (moveKey(actor?.stats, oldName, newName)) values += 1;
        }
        // Character cards - what someone off stage walks back in carrying.
        for (const card of getLibraryCharacters()) {
            if (!applies(card)) continue;
            if (moveKey(card?.statusOverrides, oldName, newName)) values += 1;
        }
    }

    const otherLists = STAT_SCOPES.filter(k => k !== listKey);
    const stillUsedElsewhere = otherLists.some(key =>
        (tracker[key] || []).some(s => s?.name === oldName))
        || !!field && (tracker[listKey] || []).some(stat => stat.id !== field.id && stat.name === oldName);

    let templateUpdated = false;
    if (!stillUsedElsewhere && typeof tracker.template === 'string') {
        // Only inside the braces, and only the whole name: a template that says "HP" in
        // its own prose is prose, and {{HPMax}} is a different stat.
        //
        // Except when the prose is the label. Text sitting immediately beside a
        // reference and reading exactly the old name is not a sentence, it is a caption
        // for the value next to it - so "HP [{{HP}}]" becomes "Health [{{Health}}]"
        // rather than a tracker that calls the field something nothing else does.
        // Done first: once the reference is rewritten there is no longer a pairing to
        // recognise.
        const word = String.fromCharCode(92) + 'p{L}' + String.fromCharCode(92) + 'p{N}_';
        const labelled = new RegExp(
            `(?<![${word}])${escapeRegExp(oldName)}(?![${word}])`
            + `([^{}]{0,4}?)`
            + `\\{\\{([#^/]?)${escapeRegExp(oldName)}\\}\\}`,
            'gu');

        const pattern = new RegExp(`\\{\\{([#^/]?)${escapeRegExp(oldName)}\\}\\}`, 'g');
        const rewritten = tracker.template
            .replace(labelled, `${newName}$1{{$2${newName}}}`)
            .replace(pattern, `{{$1${newName}}}`);
        if (rewritten !== tracker.template) {
            tracker.template = rewritten;
            templateUpdated = true;
        }
    }

    // Custom CSS is not rewritten. A selector can be built from a stat name in more ways
    // than can be recognised, and a wrong edit to someone's stylesheet is worse than a
    // sentence telling them where to look.
    const cssMentions = !stillUsedElsewhere
        && String(tracker.customCSS || '').toLowerCase().includes(oldName.toLowerCase());

    if (state) deps.saveStateToMetadata(state);
    saveSettings();
    return { values, templateUpdated, cssMentions };
}


/** Rename held collection fields while preserving key order and occupied destinations. */
function renameCollectionField(collectionId, oldName, newName) {
    if (!collectionId || !oldName || !newName || oldName === newName) return 0;

    let moved = 0;

    /** @param {object} item */
    const renameIn = (item) => {
        if (!item || typeof item !== 'object' || !Object.hasOwn(item, oldName)) return item;

        // A collision should not happen - the builder refuses a duplicate field name - but
        // if the item already carries the new key with something in it, that something is
        // the newer of the two and is not overwritten by a key the schema had abandoned.
        const occupied = item[newName] !== undefined && item[newName] !== '' && item[newName] !== null;
        const keep = occupied ? item[newName] : item[oldName];

        // Both keys collapse into one, written at whichever of the two came first. Deciding
        // the value up front rather than as the loop meets each key is what makes that true
        // in either order: written the other way, a stored {school, tradition} kept the
        // later key's value whatever the rule said, and only the reverse order tested it.
        const out = {};
        for (const [key, existing] of Object.entries(item)) {
            if (key === oldName || key === newName) {
                if (!Object.hasOwn(out, newName)) out[newName] = keep;
            } else {
                out[key] = existing;
            }
        }
        moved += 1;
        return out;
    };

    const renameInList = (list) => Array.isArray(list) ? list.map(renameIn) : list;

    const settings = getSettings();

    // The Master Database keeps one object per item name rather than a list.
    const master = settings.master_items?.[collectionId];
    if (master && typeof master === 'object') {
        for (const [itemName, itemData] of Object.entries(master)) {
            master[itemName] = renameIn(itemData);
        }
    }

    for (const persona of Object.values(settings.personaData || {})) {
        const cols = persona?.collections;
        if (cols?.[collectionId]) cols[collectionId] = renameInList(cols[collectionId]);
    }

    // Character cards - what a character walks back into a scene carrying.
    for (const card of getLibraryCharacters()) {
        const cols = card?.statusCollections;
        if (cols?.[collectionId]) cols[collectionId] = renameInList(cols[collectionId]);
    }

    const state = deps.committedState || deps.loadStateFromMetadata();
    if (state) {
        for (const actor of [state.player, ...(state.characters || [])].filter(Boolean)) {
            const cols = actor.collections;
            if (cols?.[collectionId]) cols[collectionId] = renameInList(cols[collectionId]);
        }
        deps.saveStateToMetadata(state);
    }

    saveSettings();
    return moved;
}

Object.defineProperties(deps, {
    statsInSystem: { enumerable: true, configurable: true, get: () => statsInSystem },
    renameStat: { enumerable: true, configurable: true, get: () => renameStat },
    renameCollectionField: { enumerable: true, configurable: true, get: () => renameCollectionField },
});
}
