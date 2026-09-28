/** Numeric readings the reader may change by an amount rather than recalculate. */
const READING = /^\s*(-?\d+(?:\.\d+)?)(?:\s*\/\s*(-?\d+(?:\.\d+)?))?\s*$/;

function readable(value) {
    const match = String(value ?? '').match(READING);
    return match && Number.isFinite(Number(match[1])) ? match : null;
}

function eligible(def, value) {
    return Boolean(def?.name && !def.locked && def.persistence !== 'innate'
        && !['level', 'level bonus'].includes(def.name.toLowerCase()) && readable(value));
}

function heldValue(values, name) {
    const key = Object.keys(values || {}).find(candidate => candidate.toLowerCase() === name.toLowerCase());
    return key === undefined ? undefined : values[key];
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

function expand(target, values, deltas, defs) {
    if (!deltas || typeof deltas !== 'object' || Array.isArray(deltas)) return;
    for (const [key, raw] of Object.entries(deltas)) {
        const def = (defs || []).find(item => item?.name?.toLowerCase() === key.toLowerCase());
        const held = def && heldValue(values, def.name);
        if (!def || heldValue(target, def.name) !== undefined || !eligible(def, held)) continue;
        const delta = Number(raw);
        if (typeof raw !== 'number' || !Number.isFinite(delta)) continue;
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
    const global = update.global && typeof update.global === 'object' ? update.global : (update.global = {});
    expand(global, state?.global, update.globalDeltas, settings.globalStats);
    delete update.globalDeltas;
    if (update.player?.deltas) {
        const target = update.player.stats && typeof update.player.stats === 'object'
            ? update.player.stats : update.player;
        expand(target, state?.player?.stats, update.player.deltas, settings.playerStats);
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
