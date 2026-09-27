/** The visible facts Fill wrote, in the same field order as the NPC profile. */
export function characterImageDescription(char, lore = '') {
    const profile = char?.profile || {};
    const lines = [
        ['Age', profile.age],
        ['Appearance', profile.appearance],
        ['Personality', profile.personality],
    ].filter(([, value]) => String(value ?? '').trim())
        .map(([label, value]) => `${label}: ${String(value).trim()}`);

    // Older cards may have free-form lore without named profile fields.
    return lines.length ? lines.join('\n') : String(lore || '').trim();
}
