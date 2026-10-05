const NUMERIC_VALUE = /^\s*-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?\s*$/;
const PROGRESSION_FIELDS = new Set(['xp', 'level', 'level bonus']);

/** Locked fields are excluded from ordinary reader updates. NPC initialization is separate. */
export function isReaderStat(def) {
    return Boolean(def && !def.locked);
}

/** Translate the retired policy once at loading boundaries. Explicit carryover wins. */
export function statBehavior(stat, scope, xpFieldId) {
    const advancement = stat.updatePolicy === 'advancement'
        || (!stat.updatePolicy && stat.persistence === 'innate');
    return {
        locked: stat.locked === true || (advancement && (!xpFieldId || stat.id !== xpFieldId) && String(stat.name).toLowerCase() !== 'xp'),
        ...(scope === 'npc' ? { carryOver: typeof stat.carryOver === 'boolean' ? stat.carryOver
            : advancement || (stat.updatePolicy !== undefined || stat.persistence !== undefined) && stat.locked === true } : {}),
    };
}

export function normaliseStatUpdatePolicies(tracker) {
    const xpIds = new Set([tracker?.progression?.player?.xpFieldId,
        ...(tracker?.npcTemplates || []).map(template => template.progression?.xpFieldId)].filter(Boolean));
    for (const key of ['globalStats', 'playerStats', 'npcStats']) {
        for (const stat of tracker?.[key] || []) {
            if (!stat || typeof stat !== 'object') continue;
            const behavior = statBehavior(stat, key === 'npcStats' ? 'npc' : 'player', xpIds.has(stat.id) ? stat.id : undefined);
            stat.locked = behavior.locked;
            if (key === 'npcStats') stat.carryOver = behavior.carryOver;
            delete stat.updatePolicy;
            delete stat.persistence;
            delete stat.persistenceReview;
            if (key === 'playerStats' && stat.advanceOnLevel === undefined) {
                stat.advanceOnLevel = !PROGRESSION_FIELDS.has(String(stat.name || '').toLowerCase())
                    && (stat.type === 'number' || NUMERIC_VALUE.test(String(stat.defaultValue ?? '')));
            }
        }
    }
}
