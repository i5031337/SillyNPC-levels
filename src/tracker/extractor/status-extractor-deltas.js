/** Numeric readings the reader may change by an amount rather than recalculate. */
const READING = /^\s*(-?\d+(?:\.\d+)?)(?:\s*\/\s*(-?\d+(?:\.\d+)?))?\s*$/;

function readable(value) {
    const match = String(value ?? '').match(READING);
    return match && Number.isFinite(Number(match[1])) ? match : null;
}

function eligible(def, value) {
    return Boolean(def?.name && !def.locked && isTurnStat(def)
        && !['level', 'level bonus'].includes(def.name.toLowerCase()) && readable(value));
}

function heldValue(values, name) {
    const key = Object.keys(values || {}).find(candidate => candidate.toLowerCase() === name.toLowerCase());
    return key === undefined ? undefined : values[key];
}

/** An XP field with a Level partner always uses the reader's delta contract. */
export function configuredXpName(settings) {
    const defs = settings?.playerStats || [];
    const xp = defs.find(def => def?.name?.toLowerCase() === 'xp' && !def.locked);
    return xp && isTurnStat(xp) && defs.some(def => def?.name?.toLowerCase() === 'level')
        ? xp.name : null;
}

/** A numeric held value is required before an XP delta can be awarded. */
export function progressionXpName(settings, state) {
    const name = configuredXpName(settings);
    return name && readable(heldValue(state?.player?.stats, name)) ? name : null;
}

export function numericDeltaNames(defs, values) {
    return (defs || []).filter(def => def?.name && eligible(def, heldValue(values, def.name)))
        .map(def => def.name);
}

/** Exact names the prompt can offer for numeric deltas in the current scene. */
export function describeNumericDeltas(state, settings) {
    const lines = [];
    const global = numericDeltaNames(settings.globalStats, state?.global);
    const player = numericDeltaNames(settings.playerStats, state?.player?.stats);
    if (global.length) lines.push(`World: ${global.join(', ')}`);
    if (player.length) lines.push(`Player: ${player.join(', ')}`);
    for (const actor of state?.characters || []) {
        const actorNames = numericDeltaNames(settings.npcStats, actor.stats);
        if (actorNames.length) lines.push(`${actor.name}: ${actorNames.join(', ')}`);
    }
    return lines.join('\n');
}

function expand(target, values, deltas, defs, { xpName = null } = {}) {
    if (!deltas || typeof deltas !== 'object' || Array.isArray(deltas)) return;
    for (const [key, raw] of Object.entries(deltas)) {
        const def = (defs || []).find(item => item?.name?.toLowerCase() === key.toLowerCase());
        const held = def && heldValue(values, def.name);
        if (!def || heldValue(target, def.name) !== undefined || !eligible(def, held)) continue;
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
export function expandNumericDeltas(update, state, settings) {
    if (!update || typeof update !== 'object') return update;
    const xpName = configuredXpName(settings);
    if (xpName && update.player && typeof update.player === 'object') {
        // The reader used to offer both an absolute XP reading and an XP delta. Discard
        // stray absolute values, even from replies using the old schema, before expansion.
        for (const values of [update.player, update.player.stats]) {
            if (!values || typeof values !== 'object') continue;
            for (const key of Object.keys(values)) {
                const lower = key.toLowerCase();
                const base = xpName.toLowerCase();
                if (lower === base || ['_current', '_cur', '_now', '_value', '_val',
                    '_maximum', '_max', '_total', '_cap'].some(suffix => lower === base + suffix)) {
                    delete values[key];
                }
            }
        }
    }
    const global = update.global && typeof update.global === 'object' ? update.global : (update.global = {});
    expand(global, state?.global, update.globalDeltas, settings.globalStats);
    delete update.globalDeltas;
    if (update.player?.deltas) {
        const target = update.player.stats && typeof update.player.stats === 'object'
            ? update.player.stats : update.player;
        expand(target, state?.player?.stats, update.player.deltas, settings.playerStats, { xpName });
        delete update.player.deltas;
    }
    for (const actor of Array.isArray(update.characters) ? update.characters : []) {
        if (!actor?.deltas) continue;
        const held = (state?.characters || []).find(char => char.name?.toLowerCase() === actor.name?.toLowerCase());
        const target = actor.stats && typeof actor.stats === 'object' ? actor.stats : actor;
        expand(target, held?.stats, actor.deltas, settings.npcStats);
        delete actor.deltas;
    }
    return update;
}
import { isTurnStat } from '../stat-update-policy.js';
