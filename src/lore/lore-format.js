import { npcTemplates } from '../core/npc-templates.js';
import { NPC_LORE_FIELDS, PROFILE_FIELDS } from '../core/constants-profile.js';
import { profileFieldValue, resolveProfileFields, profileFieldsForCard } from '../core/profile-fields.js';
import { normalizeMemoryStore } from '../core/profile-memories.js';

const MEMORY_HEADING = '### Memories';
const EXTRA_HEADING = '### Additional lore';
const memoryStart = text => /^### Memories(?:\r?\n|$)/.test(text)
    ? 0 : text.indexOf(`\n${MEMORY_HEADING}`);
const beforeMemories = content => {
    const text = String(content ?? '');
    const at = memoryStart(text);
    return at < 0 ? text : text.slice(0, at);
};
const profileSection = content => beforeMemories(content).split(`\n${EXTRA_HEADING}`)[0];
const memorySection = content => {
    const text = String(content ?? '');
    const at = memoryStart(text);
    return at < 0 ? '' : `\n${text.slice(at).trimStart()}`;
};

/** Keep earlier labels after a System renames or retires a field. */
export function formatLoreContent(values = {}, existingContent = '', memories, scope = 'npc', fields = resolveProfileFields(scope)) {
    const activeLabels = new Set(fields.map(field => field.label));
    const current = fields.map(field =>
        `${field.label}: ${String(profileFieldValue(values, field)).replace(/\s*\r?\n\s*/g, ' ').trim()}`)
    const previous = parseLoreContent(existingContent, { scope }) === null ? []
        : profileSection(existingContent).trim().split(/\r?\n/).filter(line => {
            const label = line.slice(0, line.indexOf(':'));
            return line.includes(':') && !activeLabels.has(label) && !line.startsWith('### ');
        });
    const activeMemories = memories === undefined ? null : normalizeMemoryStore(memories, 500).entries;
    const section = activeMemories === null ? memorySection(existingContent)
        : activeMemories.length ? `\n${MEMORY_HEADING}\n${activeMemories.map(entry => `- ${entry.text}`).join('\n')}` : '';
    const body = beforeMemories(existingContent);
    const extraAt = body.indexOf(`\n${EXTRA_HEADING}`);
    const extra = extraAt >= 0 ? body.slice(extraAt)
        : scope === 'player' && body.trim() && !parseLoreContent(existingContent, { scope })
            ? `\n${EXTRA_HEADING}\n${body.replace(/^###[^\n]*\n?/, '')}` : '';
    return ([...current, ...previous].join('\n') + extra + section).replace(/^\n(?=### Memories)/, '');
}

/** NPC storage is complete; player entries can also contain ordered partial fields. */
export function parseLoreContent(content, { allowPartial = false, scope = 'npc' } = {}) {
    const lines = profileSection(content).trim().split(/\r?\n/);
    if (lines[0]?.startsWith('### ')) lines.shift();
    const active = resolveProfileFields(scope);
    if (allowPartial) return parseGeneratedProfileFields(lines.join('\n'), scope);
    if (!lines.join('\n').trim() && memorySection(content)) return {};
    // Entries written before a System changed its fields keep their original labels.
    const templates = scope === 'npc' ? npcTemplates().map(template =>
        profileFieldsForCard({ npcTemplateId: template.id })) : [];
    for (const fields of [active, ...templates, scope === 'player' ? PROFILE_FIELDS : NPC_LORE_FIELDS]) {
        if (!fields.length) continue;
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
    if (scope === 'player') {
        const partial = parseGeneratedProfileFields(lines.join('\n'), scope);
        if (partial) return partial;
    }
    // A saved custom System may have renamed every label. Its ID cannot be inferred
    // from prose, but its old lines are still structured and can be kept verbatim.
    if (lines.length === active.length && lines.every(line => /^[^:\n]+:\s*.*$/.test(line))) return {};
    return null;
}

/** A generated reply may contain only fields supported by the story. */
export function parseGeneratedProfileFields(content, scope) {
    let text = String(content ?? '').trim();
    if (text.startsWith('### ')) text = text.replace(/^### [^\r\n]*\r?\n/, '');
    const fields = resolveProfileFields(scope);
    if (!fields.length) return null;
    // Models sometimes put every labelled field on one line. Recognize title-like
    // labels as boundaries, including inactive ones, so their values cannot leak
    // into an active field. Only active labels are returned below.
    const escape = label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const active = new RegExp(`(^|\\s)(${fields.map(field => escape(field.label))
        .sort((a, b) => b.length - a.length).join('|')}):[ \\t]*`, 'g');
    const known = [...text.matchAll(active)];
    const possible = /(^|\s)([^:\r\n.!?]{1,60}):[ \t]*/g;
    const unknown = [...text.matchAll(possible)].filter(match => {
        const label = match[2].trim();
        if (fields.some(field => field.label === label)) return false;
        const before = text.slice(0, match.index).trimEnd();
        return (!before || match[1] === '\n' || /[.!?]$/.test(before))
            && /^[A-Z]/.test(label);
    });
    const matches = [...known, ...unknown].sort((a, b) => a.index - b.index);
    if (!matches.length || text.slice(0, matches[0].index).trim()) return null;
    const values = {};
    let previousIndex = -1;
    for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const index = fields.findIndex(field => field.label === match[2].trim());
        if (index < 0) continue;
        if (index <= previousIndex) return null;
        const field = fields[index];
        const value = text.slice(match.index + match[0].length, matches[i + 1]?.index).trim();
        // A continuation line is not part of the compact named-field format.
        if (/\r?\n/.test(value)) return null;
        values[field.id] = value;
        previousIndex = index;
    }
    return previousIndex < 0 ? null : values;
}

export function mergeLoreValues(content, cardValues, scope = 'npc') {
    const parsed = parseLoreContent(content, { scope });
    if (!parsed) return null;
    return {
        ...parsed,
        ...Object.fromEntries(Object.entries(cardValues || {})
            .filter(([, value]) => typeof value === 'string' && value.trim())
            .map(([id, value]) => [id, value.trim()])),
        ...Object.fromEntries(resolveProfileFields(scope).map(field => [field.id,
            String(profileFieldValue(cardValues, field) || parsed[field.id] || '').trim()])),
    };
}
