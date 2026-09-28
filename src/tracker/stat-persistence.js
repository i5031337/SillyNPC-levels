/** The old schema did not distinguish identity from adventure state. */
const LEGACY_VARIABLE_STATS = new Set(['hp', 'energy', 'condition', 'level', 'xp']);

/** Assign a safe transfer policy without changing any stored stat values. */
export function normaliseNpcPersistence(definitions) {
    if (!Array.isArray(definitions)) return;
    for (const stat of definitions) {
        if (!stat || typeof stat !== 'object') continue;
        if (stat.persistence === 'innate' || stat.persistence === 'variable') continue;
        stat.persistence = 'variable';
        // Custom fields need an explicit choice. Until then they remain local to the
        // adventure, and their existing values stay exactly where they were.
        if (!LEGACY_VARIABLE_STATS.has(String(stat.name || '').trim().toLowerCase())) {
            stat.persistenceReview = true;
        }
    }
}

/** Split by definitions, never by the names of values found on a card. */
export function splitNpcStats(values, definitions) {
    const innate = {};
    const variable = {};
    const source = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
    for (const stat of Array.isArray(definitions) ? definitions : []) {
        if (!stat?.name) continue;
        const key = Object.keys(source).find(name => name.toLowerCase() === stat.name.toLowerCase());
        if (key === undefined) continue;
        const target = stat.persistence === 'innate' ? innate : variable;
        target[stat.name] = structuredClone(source[key]);
    }
    return { innate, variable };
}

/** A new adventure starts with destination defaults and only the permitted values. */
export function initialiseNpcStats(values, definitions) {
    const result = {};
    for (const stat of Array.isArray(definitions) ? definitions : []) {
        if (stat?.name && stat.defaultValue !== undefined) {
            result[stat.name] = structuredClone(stat.defaultValue);
        }
    }
    return { ...result, ...splitNpcStats(values, definitions).innate };
}

/** Manual edits bypass this; turn updates can touch only turn-managed fields. */
export function canTrackerSetNpcStat(definition) {
    return isTurnStat(definition);
}
import { isTurnStat } from './stat-update-policy.js';
