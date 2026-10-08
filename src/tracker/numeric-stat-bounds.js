const READING = /^\s*(-?\d+(?:\.\d+)?)(?:\s*\/\s*(-?\d+(?:\.\d+)?))?\s*$/;

/** The configured maximum, falling back to a default pool denominator. */
export function configuredNumericMaximum(def) {
    const raw = String(def?.maxStatValue ?? '').trim()
        || String(def?.defaultValue ?? '').match(READING)?.[2];
    if (raw === undefined || raw === '') return null;
    const maximum = Number(raw);
    return Number.isFinite(maximum) ? maximum : null;
}

/** A slash reading defines a pool; plain numbers are ratings with fixed bounds. */
export function isPoolStat(def, value = def?.defaultValue) {
    return def?.type === 'bar' || READING.test(String(value ?? '')) && String(value).includes('/');
}

/** Level growth expands pools but increases bounded ratings within their existing cap. */
export function statGrowthBounds(def, value) {
    const explicitMax = String(def?.maxStatValue ?? '').trim();
    const growMaximum = String(value ?? '').includes('/') && (isPoolStat(def) || !explicitMax);
    return { growMaximum, fixedMaximum: growMaximum
        ? (explicitMax ? Number(explicitMax) : null) : configuredNumericMaximum(def) };
}

/** Numeric bounds apply to the current reading; a pool carries its own live cap. */
export function constrainNumericStat(def, incoming, existing) {
    if (def?.type !== 'number' && def?.type !== 'bar') return incoming;
    if (incoming === undefined || incoming === null || String(incoming).trim() === '') return incoming;
    const match = String(incoming).match(READING);
    if (!match) return existing;
    const minimum = String(def.min ?? '').trim() === '' ? null : Number(def.min);
    const min = Number.isFinite(minimum) ? minimum : null;
    const held = String(existing ?? '').match(READING);
    const fixed = !isPoolStat(def) && !isPoolStat(def, existing) ? configuredNumericMaximum(def)
        ?? (held?.[2] === undefined ? null : Number(held[2])) : null;
    const maximum = fixed ?? (match[2] === undefined
        ? (held?.[2] === undefined ? configuredNumericMaximum(def) : Number(held[2]))
        : Number(match[2]));
    if (maximum !== null && (!Number.isFinite(maximum) || (min !== null && maximum < min))) return existing;
    let current = Number(match[1]);
    if (!Number.isFinite(current)) return existing;
    if (min !== null) current = Math.max(min, current);
    if (maximum !== null) current = Math.min(maximum, current);
    const next = match[2] === undefined ? String(current) : `${current}/${maximum}`;
    return next === String(incoming).trim() ? incoming : next;
}

/** A reader may change the current value, while the actor keeps its existing maximum. */
export function keepNumericMaximum(incoming, liveCap) {
    const match = String(incoming ?? '').match(READING);
    if (!match) return incoming;
    return liveCap ? `${match[1]}/${liveCap}` : match[1];
}
