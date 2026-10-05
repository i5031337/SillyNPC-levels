import { progressionFields } from '../progression-fields.js';
import { npcStatsFor } from '../../core/npc-templates.js';
/** Numeric readings the reader may change by an amount rather than recalculate. */
const READING = /^\s*(-?\d+(?:\.\d+)?)(?:\s*\/\s*(-?\d+(?:\.\d+)?))?\s*$/;

function readable(value) {
    const match = String(value ?? '').match(READING);
    return match && Number.isFinite(Number(match[1])) ? match : null;
}

function eligible(def, value, { xpName = null, levelName = null, enabled } = {}) {
    return Boolean(def?.name && !def.locked && (isTurnStat(def) || def.name === xpName)
        && (!enabled || def.name !== levelName) && def.name.toLowerCase() !== 'level bonus'
        && (enabled === false || def.name.toLowerCase() !== 'level') && readable(value));
}

function heldValue(values, name) {
    const key = Object.keys(values || {}).find(candidate => candidate.toLowerCase() === name.toLowerCase());
    return key === undefined ? undefined : values[key];
}

/** An XP field with a Level partner always uses the reader's delta contract. */
export function configuredXpName(settings, actor = null) {
    const fields = progressionFields(settings, { isPlayer: !actor, actor });
    const defs = actor ? settings?.npcStats : settings?.playerStats;
    const xp = (defs || []).find(def => def.name === fields.xpName);
    return fields.enabled && xp && !xp.locked ? xp.name : null;
}

/** A numeric held value is required before an XP delta can be awarded. */
export function progressionXpName(settings, state) {
    const name = configuredXpName(settings);
    return name && readable(heldValue(state?.player?.stats, name)) ? name : null;
}

export function numericDeltaNames(defs, values, fields = {}) {
    return (defs || []).filter(def => def?.name && eligible(def, heldValue(values, def.name), fields))
        .map(def => def.name);
}

/** Exact names the prompt can offer for numeric deltas in the current scene. */
export function describeNumericDeltas(state, settings) {
    const lines = [];
    const global = numericDeltaNames(settings.globalStats, state?.global);
    const player = numericDeltaNames(settings.playerStats, state?.player?.stats, progressionFields(settings, { isPlayer: true }));
    if (global.length) lines.push(`World: ${global.join(', ')}`);
    if (player.length) lines.push(`Player: ${player.join(', ')}`);
    for (const actor of state?.characters || []) {
        const actorNames = numericDeltaNames(npcStatsFor(actor, settings), actor.stats, progressionFields(settings, { actor }));
        if (actorNames.length) lines.push(`${actor.name}: ${actorNames.join(', ')}`);
    }
    return lines.join('\n');
}

function expand(target, values, deltas, defs, { xpName = null, levelName = null, enabled } = {}) {
    if (!deltas || typeof deltas !== 'object' || Array.isArray(deltas)) return;
    for (const [key, raw] of Object.entries(deltas)) {
        const def = (defs || []).find(item => item?.name?.toLowerCase() === key.toLowerCase());
        const held = def && heldValue(values, def.name);
        if (!def || heldValue(target, def.name) !== undefined || !eligible(def, held, { xpName, levelName, enabled })) continue;
        const delta = Number(raw);
        if (typeof raw !== 'number' || !Number.isFinite(delta)) continue;
        if (xpName && def.name.toLowerCase() === xpName.toLowerCase() && delta <= 0) continue;
        const match = readable(held);
        const next = Number(match[1]) + delta;
        if (!Number.isFinite(next) || Math.abs(next) > Number.MAX_SAFE_INTEGER) continue;
        const number = String(Number(next.toPrecision(12)));
        target[def.name] = match[2] === undefined ? number : `${number}/${match[2]}`;
    }
}

/** Convert reader-only deltas to the existing absolute update contract. */
export function expandNumericDeltas(update, state, settings, { cards = [] } = {}) {
    if (!update || typeof update !== 'object') return update;
    const xpName = configuredXpName(settings);
    function removeAbsoluteXp(owner, name) {
        if (!name || !owner || typeof owner !== 'object') return;
        for (const values of [owner, owner.stats]) {
            if (!values || typeof values !== 'object') continue;
            for (const key of Object.keys(values)) {
                const lower = key.toLowerCase(), base = name.toLowerCase();
                if (lower === base || ['_current', '_cur', '_now', '_value', '_val',
                    '_maximum', '_max', '_total', '_cap'].some(suffix => lower === base + suffix)) delete values[key];
            }
        }
    }
    removeAbsoluteXp(update.player, xpName);
    const global = update.global && typeof update.global === 'object' ? update.global : (update.global = {});
    expand(global, state?.global, update.globalDeltas, settings.globalStats);
    delete update.globalDeltas;
    if (update.player?.deltas) {
        const target = update.player.stats && typeof update.player.stats === 'object'
            ? update.player.stats : update.player;
        expand(target, state?.player?.stats, update.player.deltas, settings.playerStats, { ...progressionFields(settings, { isPlayer: true }), xpName });
        delete update.player.deltas;
    }
    for (const actor of Array.isArray(update.characters) ? update.characters : []) {
        if (!actor || typeof actor !== 'object') continue;
        const held = (state?.characters || []).find(char => char.name?.toLowerCase() === actor.name?.toLowerCase())
            || cards.map(card => ({ ...card, stats: card.statusOverrides || {} }))
                .find(card => [card.name, ...(card.aliases || []).filter(alias => !alias.isRegex).map(alias => alias.pattern)]
                    .some(name => name?.toLowerCase() === actor.name?.toLowerCase()));
        const fields = progressionFields(settings, { actor: held || actor });
        const actorXp = configuredXpName(settings, held || actor);
        removeAbsoluteXp(actor, actorXp);
        const target = actor.stats && typeof actor.stats === 'object' ? actor.stats : actor;
        expand(target, held?.stats, actor.deltas, npcStatsFor(held || actor, settings), { ...fields, xpName: actorXp });
        delete actor.deltas;
    }
    return update;
}
import { isTurnStat } from '../stat-update-policy.js';
