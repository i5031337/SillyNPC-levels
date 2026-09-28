/** Retire the old transfer setting after update policy has been inferred from it. */
export function normaliseNpcPersistence(definitions) {
    if (!Array.isArray(definitions)) return;
    for (const stat of definitions) {
        if (!stat || typeof stat !== 'object') continue;
        delete stat.persistence;
        delete stat.persistenceReview;
    }
}

/** Advancement and locked values belong to the character across adventures. */
export function carriesNpcStat(stat) {
    return Boolean(stat && (stat.locked || !isTurnStat(stat)));
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
        const target = carriesNpcStat(stat) ? innate : variable;
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
