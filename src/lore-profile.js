import { PROFILE_FIELDS } from './constants-profile.js';

const marker = /^([A-Za-z][A-Za-z &]+):\s*(.*)$/;
const byLabel = new Map(PROFILE_FIELDS.map(field => [field.label.toLowerCase(), field]));

/** Read the named profile fields without treating older free-form lore as profile data. */
export function splitLoreProfile(content, name = '') {
    const profile = {};
    const lines = String(content ?? '').split(/\r?\n/);
    const kept = [];
    let current = null;
    let readingFields = true;
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const identity = escaped ? new RegExp(`^###\\s+${escaped}(?:\\s+\\(also:[^\\n]*\\))?$`, 'i') : null;
    for (const line of lines) {
        if (identity?.test(line) && kept.every(part => !part.trim())) {
            current = null;
            continue;
        }
        const match = line.match(marker);
        const field = readingFields && match && byLabel.get(match[1].trim().toLowerCase());
        if (field) {
            current = field.id;
            profile[current] = match[2].trim();
        } else if (current && line.trim() && !match) {
            profile[current] += `${profile[current] ? '\n' : ''}${line}`;
        } else {
            current = null;
            kept.push(line);
            if (line.trim()) readingFields = false;
        }
    }
    return { profile, lore: kept.join('\n').trim() };
}

/** Keep legacy lore verbatim while giving every profile field a stable place in the entry. */
export function joinLoreProfile(profile, lore) {
    const fields = PROFILE_FIELDS.map(field =>
        `${field.label}: ${String(profile?.[field.id] ?? '').trim()}`);
    const body = String(lore ?? '').trim();
    return [...fields, ...(body ? ['', body] : [])].join('\n');
}

export function mergeLoreProfile(content, cardProfile, name = '') {
    const parts = splitLoreProfile(content, name);
    const profile = Object.fromEntries(PROFILE_FIELDS.map(field => [field.id,
        String(cardProfile?.[field.id] || parts.profile[field.id] || '').trim()]));
    return { profile, content: joinLoreProfile(profile, parts.lore) };
}
