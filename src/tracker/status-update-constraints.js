import { LOG_PREFIX, debugLog, PROFILE_FIELDS, isStaticField } from '../core/constants.js';
import { extractJSON, safeJsonParse, splitValue, escapeRegExp, ceilingFromValue } from '../core/utils.js';
import { constrainNumericStat } from './numeric-stat-bounds.js';

export function bind(deps) {
/** The values a field is allowed to hold, or an empty list when it allows anything. */
function allowedValues(def) {
    if (def?.type === 'number' || def?.type === 'bar') return [];
    return (def?.options || [])
        .map(value => String(value ?? '').trim())
        .filter(Boolean);
}

/**
 * Holds a field to the values it is allowed to have.
 *
 * A field with no options allows anything, which is every field until somebody says
 * otherwise. With options, a value that is not on the list is refused and whatever was
 * there stays - the point of declaring a vocabulary is that the extractor cannot quietly
 * widen it, and inventing a synonym every few messages is exactly what it does otherwise.
 *
 * Matching is exact after trimming. "healthy" is refused rather than corrected to
 * "Healthy": a list of allowed values is also a list of allowed spellings, and silently
 * rewriting one is how the sheet and the story start disagreeing about what it says.
 *
 * Refusing means keeping what is there, so a value stored before the list was narrowed
 * survives untouched. Narrowing a list in the builder must not rewrite characters nobody
 * was looking at - the same rule renaming a field follows.
 *
 * @param {object} def The stat or field definition.
 * @param {*} incoming What is being written.
 * @param {*} existing What is there now.
 * @returns {*} The value to store.
 */
/**
 * Values refused since the last time anybody asked, as lines to show.
 *
 * A word that is not on a field's list is thrown away and the old value kept, which is
 * right - a vocabulary nothing enforces is not one. But it happened in the console only,
 * and from outside it looks exactly like a reader that never reports that field: a fight
 * starts, the reader says "Tense", the list allows nine other words, and Condition sits at
 * "Happy" with nothing said. The reply is still refused; now it is said out loud.
 */
const refused = [];

/** The refusals since the last call, and clears them. */
function takeRefusedValues() {
    return refused.splice(0, refused.length);
}

function constrainToOptions(def, incoming, existing) {
    const allowed = allowedValues(def);
    if (!allowed.length) return incoming;

    const wanted = String(incoming ?? '').trim();
    // Clearing a field is always allowed: empty means "use the default" on a card, and
    // refusing it would make a value impossible to take back.
    if (!wanted) return incoming;
    if (allowed.includes(wanted)) return incoming;

    debugLog(`"${wanted}" is not an allowed value for ${def?.name || 'this field'} `
        + `(${allowed.join(', ')}); kept "${existing ?? ''}"`);
    refused.push({ field: def?.name || 'a field', wanted, allowed, kept: String(existing ?? '') });
    return existing;
}

/**
 * Cuts a value down to the field's length, if it has one.
 *
 * At a word boundary, and marked. A value cut mid-word reads as corruption rather than as
 * a limit doing its job, and an unmarked one reads as the reader's own wording - which
 * matters here because the value goes back to the reader next turn as the current state.
 *
 * @param {object} def The stat or field definition.
 * @param {*} value
 * @returns {*} Unchanged when there is no limit, or none is needed.
 */
function capToLength(def, value) {
    const limit = Number(def?.maxLength);
    if (!Number.isFinite(limit) || limit <= 0) return value;

    const text = String(value ?? '');
    if (text.length <= limit) return value;

    const cut = text.slice(0, limit);
    const lastSpace = cut.lastIndexOf(' ');
    // Only back off to a word boundary when there is a reasonable amount of it left;
    // one very long word would otherwise cut down to nothing.
    const body = (lastSpace > limit * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd();

    debugLog(`"${def?.name || 'field'}" trimmed from ${text.length} to ${limit} characters`);
    return `${body}…`;
}

/**
 * Every rule a field's definition places on an incoming value.
 *
 * One function because there is one choke point - world stats, player stats, character
 * stats and collection fields all pass through here - and two rules that both have to
 * hold. It is not called constrainToOptions any more because it no longer only does that,
 * and a name that describes half of what a function does is worse than a longer one.
 *
 * @param {object} def
 * @param {*} incoming
 * @param {*} existing
 * @returns {*}
 */
/**
 * The wording a prompt uses for a value, handed back as if it were one.
 *
 * "current/maximum" is what the fill prompt calls the shape of a value with a ceiling, and
 * a model filling in a new character wrote exactly that into Health, Essence and every text
 * field it had nothing to say about. Angle brackets are the other shape: the worked examples
 * use "<new value>" and "<exact name>". Neither is ever a value somebody meant.
 */
function looksUnfilled(value) {
    const text = String(value ?? '').trim();
    if (!text) return false;
    return /^current\s*\/\s*maximum$/i.test(text) || /^<[^>]*>$/.test(text);
}

function constrainToDefinition(def, incoming, existing) {
    if (looksUnfilled(incoming)) {
        debugLog(`Refused "${String(incoming).trim()}" for ${def?.name || 'a field'}: that is the prompt's wording, not a value`);
        return existing;
    }
    const bounded = constrainNumericStat(def, incoming, existing);
    const kept = constrainToOptions(def, bounded, existing);
    // Only ever cut what was actually written. When the options guard refuses a value it
    // hands back the one already stored, and trimming that would rewrite something nobody
    // submitted - the same rule that stops narrowing a list rewriting characters nobody
    // was looking at.
    if (kept !== incoming) return kept;
    return capToLength(def, kept);
}

function combineStatValue(existingValue, group, statDef, options = {}) {
    let value = existingValue;
    if (group.whole !== undefined) {
        value = deps.mergeStatValue(value, group.whole, options);
    }
    if (group.current === undefined && group.max === undefined) return value;

    const parts = splitValue(value);
    let current = parts.current;
    /* The value's own denominator, and nothing else. The configured maximum used to stand
       in for it, which meant a stat that had been given a ceiling in play could never lose
       one: clear the "/120" and the setting handed it straight back. The setting seeds the
       first value and says nothing after that. */
    let max = parts.max || '';

    if (group.current !== undefined) current = String(group.current).trim();
    // A raised ceiling is a change like any other, so it is visible in the diff and can be
    // held for review rather than being forbidden outright - growth is legitimate, and it
    // should be something you agreed to rather than something that happened.
    if (group.max !== undefined) max = String(group.max).trim();

    return max ? deps.clampToCeiling(`${current}/${max}`) : current;
}

/**
 * Finds the most likely existing key for a given stat name, handling synonyms.
 */
function findMatchingStatKey(existingStats, searchKey) {
    const keys = Object.keys(existingStats);
    const searchLower = searchKey.toLowerCase();
    
    // 1. Exact match
    const exact = keys.find(k => k.toLowerCase() === searchLower);
    if (exact) return exact;
    
    // 2. Synonym match
    for (const [canonical, synonyms] of Object.entries(deps.STAT_SYNONYMS)) {
        if (searchLower === canonical || synonyms.includes(searchLower)) {
            // Check if any of our existing keys are in this synonym group
            const match = keys.find(k => {
                const kLower = k.toLowerCase();
                return kLower === canonical || synonyms.includes(kLower);
            });
            if (match) return match;
        }
    }
    
    // 3. Fuzzy prefix match (e.g. "hp_current" matches "hp")
    const prefixMatch = keys.find(k => {
        const kLower = k.toLowerCase();
        return searchLower.startsWith(kLower) || kLower.startsWith(searchLower);
    });
    if (prefixMatch) return prefixMatch;

    return null;
}

/**
 * Merges an update into the current state.
 *
 * @param {object} update
 * @param {{ dryRun?: boolean, label?: string, verbatim?: boolean, allowAdvancementChanges?: boolean }} [options]
 *   dryRun returns the resulting state without saving, syncing or emitting, so callers
 *   can diff what an update *would* do before letting it happen.
 *   verbatim says the values are whole values rather than readings of part of one, which
 *   is what a person typing into a field submits - see mergeStatValue.
 * @returns {StatusState} The resulting state.
 */

Object.defineProperties(deps, {
    allowedValues: { enumerable: true, configurable: true, get: () => allowedValues },
    takeRefusedValues: { enumerable: true, configurable: true, get: () => takeRefusedValues },
    constrainToOptions: { enumerable: true, configurable: true, get: () => constrainToOptions },
    capToLength: { enumerable: true, configurable: true, get: () => capToLength },
    constrainToDefinition: { enumerable: true, configurable: true, get: () => constrainToDefinition },
    combineStatValue: { enumerable: true, configurable: true, get: () => combineStatValue },
    findMatchingStatKey: { enumerable: true, configurable: true, get: () => findMatchingStatKey },
});
}
