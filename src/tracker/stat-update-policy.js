const NUMERIC_VALUE = /^\s*-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?\s*$/;
const PROGRESSION_FIELDS = new Set(['xp', 'level', 'level bonus']);
const ADVANCEMENT_FIELDS = new Set(['level', 'level bonus']);

/** Missing legacy policies are inferred from the old transfer setting. */
export function isTurnStat(def) {
    return Boolean(def && (def.updatePolicy === 'turn'
        || (def.updatePolicy !== 'advancement' && def.persistence !== 'innate')));
}

/** Add independent policy defaults without touching any stored stat values. */
export function normaliseStatUpdatePolicies(tracker) {
    for (const key of ['playerStats', 'npcStats']) {
        for (const stat of tracker?.[key] || []) {
            if (!stat || typeof stat !== 'object') continue;
            if (stat.updatePolicy !== 'turn' && stat.updatePolicy !== 'advancement') {
                stat.updatePolicy = (key === 'npcStats' && stat.persistence === 'innate')
                    || (key === 'playerStats' && ADVANCEMENT_FIELDS.has(String(stat.name || '').toLowerCase()))
                    ? 'advancement' : 'turn';
            }
            if (key === 'playerStats' && stat.advanceOnLevel === undefined) {
                // Preserve the old bonus candidates for existing systems. New fields set
                // this explicitly to false in the editor.
                stat.advanceOnLevel = !PROGRESSION_FIELDS.has(String(stat.name || '').toLowerCase())
                    && (stat.type === 'number' || NUMERIC_VALUE.test(String(stat.defaultValue ?? '')));
            }
        }
    }
}
