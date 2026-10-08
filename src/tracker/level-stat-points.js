import { boostStat } from './progression.js';
import { statGrowthBounds } from './numeric-stat-bounds.js';
import { progressionFieldId, progressionStatEligible } from '../core/progression-config.js';

/** Spendable whole points, accounting for fixed ratings and expandable pool capacity. */
export function pointCapacity(definition, value, budget) {
    if (!Number.isSafeInteger(budget) || budget < 1) return 0;
    const bounds = statGrowthBounds(definition, value);
    const after = boostStat(value, undefined, budget, bounds);
    if (after === null) return 0;
    const part = bounds.growMaximum ? 1 : 0;
    const difference = Number(after.split('/')[part]) - Number(String(value).split('/')[part]);
    return Number.isFinite(difference) ? Math.max(0, Math.min(budget, Math.floor(difference))) : 0;
}

export function pointOptions(definitions, config, values, budget, selected = config.statIds) {
    return definitions.map(def => ({ ...def, id: progressionFieldId(def) }))
        .filter(def => selected.includes(def.id) && config.statIds.includes(def.id) && progressionStatEligible(def, config))
        .map(def => ({ id: def.id, name: def.name, definition: def, value: values?.[def.name],
            capacity: pointCapacity(def, values?.[def.name], budget) }));
}

/** Each point picks independently. A stat leaves the pool only when it reaches its cap. */
export function allocateRandomPoints(options, budget, random = Math.random) {
    const available = options.filter(option => option.capacity > 0).map(option => ({ ...option }));
    const allocations = {};
    for (let point = 0; point < budget && available.length; point++) {
        const index = Math.min(available.length - 1, Math.max(0, Math.floor(random() * available.length)));
        const option = available[index];
        allocations[option.id] = (allocations[option.id] || 0) + 1;
        if (--option.capacity === 0) available.splice(index, 1);
    }
    return allocations;
}

export function pointBudgetRow(transition, grant, allocations = {}) {
    return { scope: transition.scope, actor: transition.actor, label: 'Skill points', kind: 'stat-points',
        before: '0', after: String(grant.points), risk: 'risky',
        reason: `Level ${transition.oldLevel} → ${transition.newLevel} skill points`, grant, allocations };
}

/** Validate the user's distribution; live caps may leave some requested points unspent. */
export function pointSpend(row, definitions, config, values) {
    const budget = row.grant.points;
    if (!Number.isSafeInteger(budget) || budget < 1) return null;
    const options = pointOptions(definitions, config, values, budget, row.grant.statIds);
    const allocations = row.allocations;
    if (!allocations || typeof allocations !== 'object' || Array.isArray(allocations)) return null;
    const choices = [];
    let requested = 0;
    for (const [id, amount] of Object.entries(allocations)) {
        const option = options.find(option => option.id === id);
        if (!option || !Number.isSafeInteger(amount) || amount < 0) return null;
        requested += amount;
        if (!Number.isSafeInteger(requested) || requested > budget) return null;
        const gain = Math.min(amount, option.capacity);
        if (gain) choices.push({ ...option, gain });
    }
    return { choices, spent: choices.reduce((total, choice) => total + choice.gain, 0) };
}
