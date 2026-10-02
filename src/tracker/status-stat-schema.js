import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from '../core/settings.js';
import { getAllCharacters, getLibraryCharacters } from '../characters/character-repository.js';
import { extractJSON, safeJsonParse, splitValue, escapeRegExp, ceilingFromValue } from '../core/utils.js';

export function bind(deps) {
const STAT_SCOPES = {
    globalStats: { ruleScope: 'global' },
    playerStats: { ruleScope: 'player' },
    npcStats: { ruleScope: 'characters' },
};

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

/**
 * Renames a stat, carrying its stored values and the settings that point at it.
 *
 * Stats are keyed by their name in five places, and the builder used to change only the
 * name in the schema. Everything else then failed to find the stat and filled it in at
 * its default - which is why renaming "HP" to "Health" showed 100 where 300/3000 had
 * been, and why the HUD stopped drawing it as a meter: a bare default has no ceiling, and
 * only a value with one can be a meter.
 *
 * Nothing deleted the old values. They stayed under the old key, unreachable, which is
 * the reason this can be repaired at all rather than only prevented.
 *
 * References are machine-written and are moved with the stat: the scene binding, and any
 * time rule whose scope points at this list. The display template is only rewritten when
 * the old name is unambiguous - if another stat list still has a stat by that name, a
 * {{HP}} in the template may well mean that one, and rewriting it would break a working
 * template to fix one that is not.
 *
 * @param {'globalStats'|'playerStats'|'npcStats'} listKey
 * @param {string} oldName
 * @param {string} newName
 * @returns {{ values: number, references: number, templateUpdated: boolean, cssMentions: boolean }}
 */
/**
 * The stored values a stat list still recognises.
 *
 * The schema lives in settings and the values live in the chat's metadata, and deleting a
 * stat in System Builder only removes it from the first. Nothing removed the value, and
 * four separate places read the stored object directly rather than the schema - the tracker
 * box, the scene block sent to the story model, the reader's prompt, and the sheet's
 * history - so a deleted stat kept being drawn and kept being sent on every message. It
 * could never change, because applyUpdate filters incoming values against the schema and
 * rejects anything it does not know; it was simply inert and permanent.
 *
 * So the schema is what decides, at every point that reads. The stored values are left
 * alone deliberately rather than deleted: they cost nothing once nobody reads them, and
 * erasing them would take a stat's history with it the moment somebody deletes one by
 * mistake - or the moment a System Profile switch changes the schema under a chat.
 *
 * Case-insensitively, because a stored key and a configured name differ in case often
 * enough that findMatchingStatKey and the player sheet both already allow for it.
 *
 * @param {Record<string, any>} stored The stats as the chat holds them.
 * @param {'globalStats'|'playerStats'|'npcStats'} listKey
 * @returns {Record<string, any>} A copy holding only what the schema still declares.
 */
function statsInSystem(stored, listKey) {
    if (!stored || typeof stored !== 'object') return {};
    const declared = new Set(
        (getSettings().statusTracker?.[listKey] || [])
            .map(stat => String(stat?.name ?? '').trim().toLowerCase())
            .filter(Boolean));

    const out = {};
    for (const [key, value] of Object.entries(stored)) {
        if (declared.has(String(key).trim().toLowerCase())) out[key] = value;
    }
    return out;
}

function renameStat(listKey, oldName, newName) {
    const empty = { values: 0, references: 0, templateUpdated: false, cssMentions: false };
    if (!STAT_SCOPES[listKey] || !oldName || !newName || oldName === newName) return empty;

    const settings = getSettings();
    const tracker = settings.statusTracker;
    let values = 0;
    let references = 0;

    const state = deps.committedState || deps.loadStateFromMetadata();

    if (listKey === 'globalStats' && state) {
        if (moveKey(state.global, oldName, newName)) values += 1;
    }

    if (listKey === 'playerStats') {
        if (state && moveKey(state.player?.stats, oldName, newName)) values += 1;
        // Every persona, not just the active one: the others are not loaded now but are
        // the same player returning to a different chat.
        for (const persona of Object.values(settings.personaData || {})) {
            if (moveKey(persona?.stats, oldName, newName)) values += 1;
        }
    }

    if (listKey === 'npcStats') {
        for (const actor of (state?.characters || [])) {
            if (moveKey(actor?.stats, oldName, newName)) values += 1;
        }
        // Character cards - what someone off stage walks back in carrying.
        for (const card of getLibraryCharacters()) {
            if (moveKey(card?.statusOverrides, oldName, newName)) values += 1;
        }
    }

    // A rule names both the stat it changes and the stat it reads to decide whether to.
    const ruleScope = STAT_SCOPES[listKey].ruleScope;
    for (const rule of tracker.timeRules || []) {
        const scope = rule.scope === 'global' ? 'global'
            : rule.scope === 'characters' ? 'characters' : 'player';
        if (scope !== ruleScope) continue;
        if (rule.stat === oldName) { rule.stat = newName; references += 1; }
        if (rule.conditionStat === oldName) { rule.conditionStat = newName; references += 1; }
    }

    const otherLists = Object.keys(STAT_SCOPES).filter(k => k !== listKey);
    const stillUsedElsewhere = otherLists.some(key =>
        (tracker[key] || []).some(s => s?.name === oldName));

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
    return { values, references, templateUpdated, cssMentions };
}


/**
 * Moves a stored value from one field name to another, everywhere it is kept.
 *
 * A rename in the builder used to be read as one field leaving and another arriving: the
 * old key was not in the schema any more, so the next write to that item filtered it out
 * and the value went with it. Silently, and item by item as each one happened to be
 * touched, which is the hardest kind of loss to notice.
 *
 * The key keeps its position in the object rather than being appended at the end. Nothing
 * reads items positionally, but a settings file where a rename shuffles every item is
 * harder to read and harder to diff.
 *
 * @param {string} collectionId
 * @param {string} oldName
 * @param {string} newName
 * @returns {number} How many items were changed - the caller says so, because a rename
 *   that moved nothing and a rename that moved forty items look identical otherwise.
 */
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

/**
 * What a system deliberately does NOT carry.
 *
 * Stated as an exclusion rather than a list of what to keep. A system used to capture
 * thirteen named keys, which meant every setting added afterwards was silently left
 * global - Time Rules, the clock, review thresholds, the lore and portrait prompts and
 * the lorebook selections all followed you from one ruleset into the next. An allow-list
 * falls behind by default; this way a new setting travels unless somebody decides it
 * should not.
 *
 * The line is your world versus your machine: everything about the fiction belongs to the
 * system, and the connections that do the work belong to you.
 */

Object.defineProperties(deps, {
    statsInSystem: { enumerable: true, configurable: true, get: () => statsInSystem },
    renameStat: { enumerable: true, configurable: true, get: () => renameStat },
    renameCollectionField: { enumerable: true, configurable: true, get: () => renameCollectionField },
});
}
