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

/** Turn pools grow capacity; Advancement ratings remain within their fixed upper bound. */
export function boostStat(previousValue, proposedValue, amount,
    { growMaximum = false, fixedMaximum = null } = {}) {
    const [currentText] = String(proposedValue ?? previousValue ?? '').split('/');
    const [, previousCap] = String(previousValue ?? '').split('/');
    const current = Number(currentText);
    if (!Number.isFinite(current) || !Number.isInteger(amount) || amount < 1) return null;
    const cap = previousCap ? Number(previousCap) : null;
    if (cap !== null && (!Number.isFinite(cap) || cap <= 0)) return null;
    const nextCap = cap === null ? null : growMaximum ? cap + amount : cap;
    const limit = fixedMaximum === null ? nextCap : fixedMaximum;
    const next = limit === null ? current + amount : Math.min(current + amount, limit);
    return nextCap === null ? String(next) : `${next}/${fixedMaximum ?? nextCap}`;
}
