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

/** Raise a numeric stat's current value, keeping its live maximum. */
export function boostStat(previousValue, proposedValue, amount) {
    const [currentText] = String(proposedValue ?? previousValue ?? '').split('/');
    const [, previousCap] = String(previousValue ?? '').split('/');
    const current = Number(currentText);
    if (!Number.isFinite(current) || !Number.isInteger(amount) || amount < 1) return null;
    const cap = previousCap ? Number(previousCap) : null;
    if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) return null;
    return cap === null ? String(current + amount) : `${Math.min(current + amount, cap)}/${cap}`;
}
