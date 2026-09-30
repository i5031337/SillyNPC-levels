import { NPC_LORE_FIELDS } from '../core/constants-profile.js';
import { resolveProfileFields } from '../core/profile-fields.js';
import { normalizeMemoryStore } from '../core/profile-memories.js';

const MEMORY_HEADING = '### Memories';
const beforeMemories = content => String(content ?? '').split(`\n${MEMORY_HEADING}`)[0];
const memorySection = content => {
    const text = String(content ?? '');
    const at = text.indexOf(`\n${MEMORY_HEADING}`);
    return at < 0 ? '' : text.slice(at);
};

/** Keep earlier labels after a System renames or retires a field. */
export function formatLoreContent(values = {}, existingContent = '', memories) {
    const fields = resolveProfileFields('npc');
    const activeLabels = new Set(fields.map(field => field.label));
    const current = fields.map(field =>
        `${field.label}: ${String(values[field.id] ?? '').replace(/\s*\r?\n\s*/g, ' ').trim()}`)
    const previous = parseLoreContent(existingContent) === null ? []
        : beforeMemories(existingContent).trim().split(/\r?\n/).filter(line => {
            const label = line.slice(0, line.indexOf(':'));
            return line.includes(':') && !activeLabels.has(label) && !line.startsWith('### ');
        });
    const activeMemories = memories === undefined ? null : normalizeMemoryStore(memories, 500).entries;
    const section = activeMemories === null ? memorySection(existingContent)
        : activeMemories.length ? `\n${MEMORY_HEADING}\n${activeMemories.map(entry => `- ${entry.text}`).join('\n')}` : '';
    return [...current, ...previous].join('\n') + section;
}

/** Parse stored entries strictly; accept ordered subsets only from fresh generation. */
export function parseLoreContent(content, { allowPartial = false } = {}) {
    const lines = beforeMemories(content).trim().split(/\r?\n/);
    if (lines[0]?.startsWith('### ')) lines.shift();
    const active = resolveProfileFields('npc');
    if (allowPartial) return parseGeneratedProfileFields(lines.join('\n'), 'npc');
    // Entries written before a System changed its fields keep their original labels.
    for (const fields of [active, NPC_LORE_FIELDS]) {
        if (lines.length < fields.length) continue;
        const values = {};
        if (fields.every((field, i) => {
            const prefix = `${field.label}:`;
            if (!lines[i].startsWith(prefix)) return false;
            values[field.id] = lines[i].slice(prefix.length).trim();
            return true;
        }) && lines.slice(fields.length).every(line => /^[^:\n]+:\s*.*$/.test(line))) {
            for (const line of lines.slice(fields.length)) {
                const old = NPC_LORE_FIELDS.find(field => line.startsWith(`${field.label}:`));
                if (old && !Object.hasOwn(values, old.id)) values[old.id] = line.slice(old.label.length + 1).trim();
            }
            return values;
        }
    }
    // A saved custom System may have renamed every label. Its ID cannot be inferred
    // from prose, but its old lines are still structured and can be kept verbatim.
    if (lines.length === active.length && lines.every(line => /^[^:\n]+:\s*.*$/.test(line))) return {};
    return null;
}

/** A generated reply may contain only fields supported by the story. */
export function parseGeneratedProfileFields(content, scope) {
    const lines = String(content ?? '').trim().split(/\r?\n/);
    if (lines[0]?.startsWith('### ')) lines.shift();
    const fields = resolveProfileFields(scope);
    const values = {};
    let previousIndex = -1;
    for (const line of lines) {
        const index = fields.findIndex(field => line.startsWith(`${field.label}:`));
        if (index <= previousIndex) return null;
        const field = fields[index];
        if (!field) return null;
        values[field.id] = line.slice(field.label.length + 1).trim();
        previousIndex = index;
    }
    return previousIndex < 0 ? null : values;
}

export function mergeLoreValues(content, cardValues) {
    const parsed = parseLoreContent(content);
    if (!parsed) return null;
    return {
        ...parsed,
        ...Object.fromEntries(Object.entries(cardValues || {})
            .filter(([, value]) => typeof value === 'string' && value.trim())
            .map(([id, value]) => [id, value.trim()])),
        ...Object.fromEntries(resolveProfileFields('npc').map(field => [field.id,
            String(cardValues?.[field.id] || parsed[field.id] || '').trim()])),
    };
}
