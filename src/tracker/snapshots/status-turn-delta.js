/** Small, storage-safe changes between two plain state snapshots. */
export function diffTurnValues(before, after, path = []) {
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    if (Array.isArray(before) && Array.isArray(after)) {
        const named = before.every(value => value && typeof value.name === 'string')
            && after.every(value => value && typeof value.name === 'string')
            && new Set(before.map(value => value.name)).size === before.length
            && new Set(after.map(value => value.name)).size === after.length;
        if (named) {
            const changes = [];
            for (const value of before) {
                const next = after.find(item => item.name === value.name);
                if (!next) changes.push({ path: [...path, { actor: value.name }], remove: true });
                else changes.push(...diffTurnValues(value, next, [...path, { actor: value.name }]));
            }
            for (const value of after) if (!before.some(item => item.name === value.name)) {
                changes.push({ path: [...path, { actor: value.name }], value: structuredClone(value) });
            }
            return changes;
        }
        if (before.length !== after.length) return [{ path, value: structuredClone(after) }];
        return before.flatMap((value, index) => diffTurnValues(value, after[index], [...path, index]));
    }
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    if (object(before) && object(after)) {
        const changes = [];
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
            if (!(key in after)) changes.push({ path: [...path, key], remove: true });
            else if (!(key in before)) changes.push({ path: [...path, key], value: structuredClone(after[key]) });
            else changes.push(...diffTurnValues(before[key], after[key], [...path, key]));
        }
        return changes;
    }
    return [{ path, value: structuredClone(after) }];
}

/** Applies a saved change list to a clone, leaving its input untouched. */
export function applyTurnValues(base, changes = []) {
    let result = structuredClone(base);
    const child = (target, key) => key && typeof key === 'object' && 'actor' in key
        ? target?.find?.(value => value?.name === key.actor) : target?.[key];
    for (const change of changes) {
        if (!Array.isArray(change?.path)) continue;
        if (change.path.length === 0) {
            if (!change.remove) result = structuredClone(change.value);
            continue;
        }
        let target = result;
        for (const key of change.path.slice(0, -1)) {
            if (!target || typeof target !== 'object') break;
            target = child(target, key);
        }
        if (!target || typeof target !== 'object') continue;
        const key = change.path.at(-1);
        if (key && typeof key === 'object' && 'actor' in key) {
            if (!Array.isArray(target)) continue;
            const index = target.findIndex(value => value?.name === key.actor);
            if (change.remove && index !== -1) target.splice(index, 1);
            else if (!change.remove && index === -1) target.push(structuredClone(change.value));
            else if (!change.remove) target[index] = structuredClone(change.value);
            continue;
        }
        if (change.remove) delete target[key];
        else target[key] = structuredClone(change.value);
    }
    return result;
}

/** A saved effect must belong to both the visible swipe and its exact text. */
export function turnEffectStatus(effects, message) {
    if (!effects) return 'absent';
    return effects.swipe === Number(message?.swipe_id ?? 0)
        && effects.text === String(message?.mes ?? '') ? 'valid' : 'mismatch';
}
