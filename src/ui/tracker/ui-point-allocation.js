import { getSettings } from '../../core/settings.js';
import { resolveProgressionConfig } from '../../core/progression-config.js';
import { getAllCharacters } from '../../characters/character-repository.js';
import { loadStateFromMetadata } from '../../tracker/status-logic.js';
import { reviewActor } from '../../tracker/level-grant-review.js';
import { pointOptions, allocateRandomPoints } from '../../tracker/level-stat-points.js';

/** A pending point budget can be partially spent and reopened later. */
export function buildPointAllocation(row) {
    const change = row.change, grant = change.grant;
    const tracker = getSettings().statusTracker;
    const actor = reviewActor(change, loadStateFromMetadata(), getAllCharacters());
    const config = resolveProgressionConfig(tracker, { isPlayer: change.scope === 'player', templateId: actor?.npcTemplateId });
    const definitions = tracker[change.scope === 'player' ? 'playerStats' : 'npcStats'] || [];
    const options = pointOptions(definitions, config, actor?.stats, grant.points, grant.statIds);
    row.allocations = { ...(change.allocations || {}) };
    if (grant.assignment === 'random' && !Object.keys(row.allocations).length) {
        row.allocations = allocateRandomPoints(options, grant.points);
    }
    const wrap = document.createElement('div'); wrap.className = 'sillynpc-point-allocation';
    const summary = document.createElement('strong'); wrap.append(summary);
    const inputs = [];
    const refresh = () => {
        const used = Object.values(row.allocations).reduce((total, amount) => total + amount, 0);
        const remaining = grant.points - used;
        summary.textContent = `${remaining} of ${grant.points} points remaining`;
        for (const { input, option } of inputs) input.max = String(Math.min(option.capacity,
            remaining + (row.allocations[option.id] || 0)));
    };
    for (const option of options) {
        const label = document.createElement('label');
        label.textContent = `${option.name} `;
        if (grant.assignment === 'manual') {
            const input = document.createElement('input'); input.type = 'number'; input.className = 'text_pole';
            input.min = '0'; input.step = '1'; input.value = row.allocations[option.id] || 0;
            input.disabled = option.capacity === 0;
            input.setAttribute('aria-label', `${option.name} skill points`);
            input.addEventListener('input', () => {
                const amount = Number(input.value);
                if (!input.value.trim() || !Number.isSafeInteger(amount) || amount < 0 || amount > Number(input.max)) {
                    input.value = row.allocations[option.id] || 0; return;
                }
                row.allocations[option.id] = amount; refresh();
            });
            for (const event of ['keydown', 'keyup', 'keypress']) input.addEventListener(event, e => e.stopPropagation());
            inputs.push({ input, option }); label.append(input);
        } else {
            const value = document.createElement('span'); value.textContent = `+${row.allocations[option.id] || 0}`;
            label.append(value);
        }
        if (!option.capacity) label.title = 'This stat cannot accept another point';
        wrap.append(label);
    }
    const help = document.createElement('small');
    help.textContent = grant.assignment === 'manual'
        ? 'Allocate points, then Apply selected. Unspent points stay here for later.'
        : 'Random allocation. Unspent points stay here if every selected stat is capped.';
    wrap.append(help); refresh();
    return wrap;
}
