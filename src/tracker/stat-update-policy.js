import { progressXp } from './progression.js';

const NUMERIC_VALUE = /^\s*-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?\s*$/;
const PROGRESSION_FIELDS = new Set(['xp', 'level', 'level bonus']);
const ADVANCEMENT_FIELDS = new Set(['level', 'level bonus']);

/** Missing legacy policies are inferred from the old transfer setting. */
export function isTurnStat(def) {
    return Boolean(def && (def.updatePolicy === 'turn'
        || (def.updatePolicy !== 'advancement' && def.persistence !== 'innate')));
}

/** A level-up may raise a player stat only when the System Builder opts it in. */
export function canAdvanceStat(def) {
    return Boolean(def?.name && def.advanceOnLevel === true && !def.locked
        && !PROGRESSION_FIELDS.has(def.name.toLowerCase()));
}

/** Keep the optional bonus under review without delaying earned XP or Level. */
export function holdLevelBonusChanges(auto, pending, bonus) {
    if (!bonus) return;
    const isBonus = change => change.scope === 'player' && [bonus.stat, bonus.bonusName]
        .some(name => name && name.toLowerCase() === change.label?.toLowerCase());
    const mark = change => {
        change.risk = 'risky';
        change.reason = 'Level-up bonus';
        if (bonus.stat && change.label?.toLowerCase() === bonus.stat.toLowerCase()) {
            change.note = bonus.description;
        }
    };
    for (const change of pending) if (isBonus(change)) mark(change);
    for (let i = auto.length - 1; i >= 0; i--) {
        const change = auto[i];
        if (!isBonus(change)) continue;
        mark(change);
        pending.push(change);
        auto.splice(i, 1);
    }
}

/** Inline narration may supply a bonus only when this same update earns a level. */
export function earnsLevel(update, state) {
    const incoming = update?.player?.stats || update?.player || {};
    const current = state?.player?.stats || {};
    const xpName = Object.keys(current).find(key => key.toLowerCase() === 'xp');
    const levelName = Object.keys(current).find(key => key.toLowerCase() === 'level');
    const incomingXp = Object.keys(incoming).find(key => key.toLowerCase() === 'xp');
    return Boolean(xpName && levelName && incomingXp
        && progressXp(current[xpName], incoming[incomingXp], current[levelName])?.levelsGained > 0);
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
