/** Names from collections selected for portrait generation. */
export function imageItemsFromCollections(collections = {}, definitions = [], isPlayer = false) {
    const names = [];
    const seen = new Set();
    const scope = isPlayer ? 'player' : 'npc';
    for (const collection of definitions) {
        if (!collection?.id || collection.includeInImagePrompt === false || collection.retired
            || (collection.target && collection.target !== 'all' && collection.target !== scope)) continue;
        const primary = collection.fields?.find(field => field.isPrimary)?.name || 'name';
        for (const item of collections[collection.id] || []) {
            const name = String(item?.[primary] ?? '').trim();
            const key = name.toLowerCase();
            if (!name || seen.has(key)) continue;
            seen.add(key);
            names.push(name);
        }
    }
    return names.join(', ');
}
