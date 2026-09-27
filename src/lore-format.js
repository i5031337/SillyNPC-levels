import { NPC_LORE_FIELDS } from './constants-profile.js';

/** SillyTavern stores one entry as text; these named lines are its exact NPC format. */
export function formatLoreContent(values = {}) {
    return NPC_LORE_FIELDS.map(field =>
        `${field.label}: ${String(values[field.id] ?? '').replace(/\s*\r?\n\s*/g, ' ').trim()}`)
        .join('\n');
}

/** Return null for malformed text so it cannot silently overwrite structured fields. */
export function parseLoreContent(content) {
    const lines = String(content ?? '').trim().split(/\r?\n/);
    if (lines[0]?.startsWith('### ')) lines.shift();
    if (lines.length !== NPC_LORE_FIELDS.length) return null;
    const values = {};
    for (let i = 0; i < NPC_LORE_FIELDS.length; i++) {
        const field = NPC_LORE_FIELDS[i];
        const prefix = `${field.label}:`;
        if (!lines[i].startsWith(prefix)) return null;
        values[field.id] = lines[i].slice(prefix.length).trim();
    }
    return values;
}

export function mergeLoreValues(content, cardValues) {
    const parsed = parseLoreContent(content);
    if (!parsed) return null;
    return Object.fromEntries(NPC_LORE_FIELDS.map(field => [field.id,
        String(cardValues?.[field.id] || parsed[field.id] || '').trim()]));
}
