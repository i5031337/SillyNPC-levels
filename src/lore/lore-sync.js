import { loadWorldInfo, saveWorldInfo } from '../../../../../world-info.js';
import { formatLoreContent, parseLoreContent, mergeLoreValues } from './lore-format.js';
import { saveSettings } from '../core/settings.js';
import { syncEntryIdentity } from './lorebook.js';

const pending = new Map();
function inOrder(world, uid, work) {
    const key = `${world}\u0000${uid}`;
    const next = (pending.get(key) || Promise.resolve()).catch(() => {}).then(work);
    pending.set(key, next);
    next.then(() => { if (pending.get(key) === next) pending.delete(key); },
        () => { if (pending.get(key) === next) pending.delete(key); });
    return next;
}

export function readLoreValues(content, cardProfile) {
    return mergeLoreValues(content, cardProfile);
}

/** Write current structured card values to its linked lorebook entry. */
export async function syncProfileToLore(char, memories) {
    if (!char?.lorebook?.world) return;
    const { world, uid } = char.lorebook;
    return inOrder(world, uid, async () => {
        const data = await loadWorldInfo(world);
        const entry = data?.entries?.[uid];
        if (!entry) throw new Error(`Lorebook entry ${world} / #${uid} is missing.`);
        const parsed = entry.content ? parseLoreContent(entry.content) : {};
        if (!parsed) throw new Error('NPC lore does not match the required field format.');
        const values = entry.content ? mergeLoreValues(entry.content, char.profile) : char.profile;
        const previous = entry.content;
        const title = entry.comment;
        entry.content = formatLoreContent(values, previous, memories);
        syncEntryIdentity(char, entry);
        entry.comment = title;
        if (entry.content !== previous) await saveWorldInfo(world, data);
        if (Object.entries(values || {}).some(([id, value]) => char.profile?.[id] !== value)) {
            char.profile = { ...char.profile, ...values };
            saveSettings();
        }
    });
}
