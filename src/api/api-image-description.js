import { profileFieldValue, profileFieldsForCard } from '../core/profile-fields.js';

export function characterImageDescription(char, lore = '') {
    const profile = char?.profile || {};
    const fields = profileFieldsForCard(char);
    const selected = fields.filter(field => field.includeInImagePrompt === true);
    if (!selected.length) return '';
    const lines = selected.filter(field => String(profileFieldValue(profile, field)).trim())
        .map(field => `${field.label}: ${String(profileFieldValue(profile, field)).trim()}`);
    if (lines.length) return lines.join('\n');
    // Free-form lore supports cards without any populated configured profile fields.
    // Never reintroduce fields the user deliberately excluded through a lore fallback.
    return fields.some(field => String(profileFieldValue(profile, field)).trim())
        ? '' : String(lore || '').trim();
}
