/** Serialize allocation so concurrent saves cannot allocate duplicate entries or UIDs. */
export function createLoreEntryStore({ load, save, allocate, identify, persist }) {
    let pending = Promise.resolve();
    return (card, world, name, owner, { isCurrent = () => true } = {}) => {
        const work = pending.catch(() => {}).then(async () => {
            if (!isCurrent()) return null;
            if (!world) throw new Error('No lorebook selected.');
            const data = await load(world);
            if (!isCurrent()) return null;
            if (!data?.entries) throw new Error(`Could not load lorebook "${world}".`);
            const linked = card.lorebook?.world === world
                ? data.entries[card.lorebook.uid] : null;
            const existing = (owner && Object.values(data.entries)
                .find(entry => entry.sillynpcOwner === owner)) || linked;
            const entry = existing || allocate(world, data);
            if (!entry) throw new Error('SillyTavern could not allocate a new entry.');
            if (!existing) {
                entry.content = '';
                identify({ ...card, name }, entry);
            }
            if (!existing || (owner && !entry.sillynpcOwner)) {
                if (owner && !entry.sillynpcOwner) entry.sillynpcOwner = owner;
                await save(world, data);
            }
            if (!isCurrent()) return null;
            card.lorebook = { world, uid: entry.uid };
            persist();
            return { ...card.lorebook };
        });
        pending = work;
        return work;
    };
}
