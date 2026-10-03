import { profileFieldsForCard } from '../core/profile-fields.js';
import { loadWorldInfo, saveWorldInfo } from '../../../../../world-info.js';
import { formatLoreContent, parseLoreContent, mergeLoreValues } from './lore-format.js';
import { saveSettings } from '../core/settings.js';
import { syncEntryIdentity, ensureChatLorebookForFill } from './lorebook.js';
import { createLoreEntry } from './lore-entries.js';

const pending = new Map();
function inOrder(world, work) {
    const key = world;
    const next = (pending.get(key) || Promise.resolve()).catch(() => {}).then(work);
    pending.set(key, next);
    next.then(() => { if (pending.get(key) === next) pending.delete(key); },
        () => { if (pending.get(key) === next) pending.delete(key); });
    return next;
}

export function readLoreValues(content, cardProfile, scope = 'npc') {
    return mergeLoreValues(content, cardProfile, scope);
}

/** Write current structured card values to its linked lorebook entry. */
export async function syncProfileToLore(char, memories, { isCurrent = () => true } = {}) {
    if (!char?.name || !isCurrent()) return;
    if (!char.lorebook?.world) {
        if (!Object.values(char.profile || {}).some(value => String(value ?? '').trim())) return;
        const target = await ensureChatLorebookForFill();
        if (!target || !isCurrent()) return;
        await createLoreEntry(char, target, char.name, { isCurrent });
    }
    if (!isCurrent() || !char.lorebook) return;
    const { world, uid } = char.lorebook;
    const scope = char.isPlayer ? 'player' : 'npc';
    return inOrder(world, async () => {
        const data = await loadWorldInfo(world);
        if (!isCurrent()) return;
        const entry = data?.entries?.[uid];
        if (!entry) throw new Error(`Lorebook entry ${world} / #${uid} is missing.`);
        const parsed = entry.content ? parseLoreContent(entry.content, { scope }) : {};
        if (!parsed && !char.isPlayer) throw new Error('Character lore does not match the required field format.');
        const values = (entry.content && mergeLoreValues(entry.content, char.profile, scope)) || char.profile;
        const previous = entry.content;
        const title = entry.comment;
        entry.content = formatLoreContent(values, previous, memories, scope, profileFieldsForCard(char));
        const identityChanged = syncEntryIdentity(char, entry);
        entry.comment = title;
        if (entry.content !== previous || identityChanged) await saveWorldInfo(world, data);
        if (!isCurrent()) return;
        if (Object.entries(values || {}).some(([id, value]) => char.profile?.[id] !== value)) {
            char.profile = { ...char.profile, ...values };
            saveSettings();
        }
    });
}
