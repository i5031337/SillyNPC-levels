import { loadWorldInfo, saveWorldInfo } from '../../../../world-info.js';
import { mergeLoreProfile, splitLoreProfile, joinLoreProfile } from './lore-profile.js';
import { saveSettings } from './settings.js';
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

/** Bring old linked text into the common layout while retaining its free-form lore. */
export async function syncProfileToLore(char) {
    if (!char?.lorebook?.world) return;
    const { world, uid } = char.lorebook;
    return inOrder(world, uid, async () => {
        const data = await loadWorldInfo(world);
        const entry = data?.entries?.[uid];
        if (!entry) throw new Error(`Lorebook entry ${world} / #${uid} is missing.`);
        const merged = mergeLoreProfile(entry.content, char.profile, char.name);
        const previous = entry.content;
        const title = entry.comment;
        entry.content = merged.content;
        syncEntryIdentity(char, entry);
        entry.comment = title;
        if (entry.content !== previous) await saveWorldInfo(world, data);
        if (Object.entries(merged.profile).some(([id, value]) => char.profile?.[id] !== value)) {
            char.profile = { ...char.profile, ...merged.profile };
            saveSettings();
        }
    });
}

/** Save the unified editor, retaining card fields for tracker and portrait consumers. */
export async function saveUnifiedLore(char, world, uid, profile, lore, comment) {
    return inOrder(world, uid, async () => {
        const data = await loadWorldInfo(world);
        const entry = data?.entries?.[uid];
        if (!entry) throw new Error(`Lorebook entry ${world} / #${uid} is missing.`);
        entry.content = joinLoreProfile(profile, lore);
        syncEntryIdentity(char, entry);
        if (comment !== undefined) entry.comment = comment;
        await saveWorldInfo(world, data);
        char.profile = { ...char.profile, ...profile };
        saveSettings();
    });
}

/** Read named values from a linked entry without replacing a filled card field. */
export function profileFromLore(content, cardProfile, name = '') {
    const parsed = splitLoreProfile(content, name);
    return { lore: parsed.lore, profile: mergeLoreProfile(content, cardProfile, name).profile };
}
