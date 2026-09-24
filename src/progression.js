/** Pure XP arithmetic. XP updates are absolute readings, not amounts to add. */
export function progressXp(previousXp, incomingXp, previousLevel) {
    const oldText = String(previousXp ?? '');
    const nextText = String(incomingXp ?? '').trim();
    const [, oldCap] = oldText.split('/');
    const [nextCurrent, nextCap] = nextText.split('/');
    const cap = Number(nextCap || oldCap);
    const earned = Number(nextCurrent);
    const level = Number(previousLevel);

    if (!nextText || !Number.isFinite(cap) || cap <= 0 || !Number.isFinite(earned)
        || earned < 0 || !Number.isSafeInteger(level) || level < 1) return null;
    const levelsGained = Math.floor(earned / cap);
    if (!Number.isSafeInteger(levelsGained) || level + levelsGained > Number.MAX_SAFE_INTEGER) return null;
    return {
        xp: `${earned % cap}/${cap}`,
        level: String(level + levelsGained),
        levelsGained,
    };
}

/** Raise a numeric stat and its live maximum, using a proposed current value if present. */
export function boostStat(previousValue, proposedValue, amount) {
    const [currentText, proposedCap] = String(proposedValue ?? previousValue ?? '').split('/');
    const [, previousCap] = String(previousValue ?? '').split('/');
    const current = Number(currentText);
    const capText = proposedCap || previousCap;
    if (!Number.isFinite(current) || !Number.isInteger(amount) || amount < 1) return null;
    const cap = capText ? Number(capText) : null;
    if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) return null;
    return cap === null ? String(current + amount) : `${current + amount}/${cap + amount}`;
}
