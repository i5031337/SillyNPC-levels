/** Repair an omitted collection ID only when the actor has one possible destination. */
export function normalizeCollectionUpdates(update, settings) {
    const warnings = [];
    const normalize = (actor, target) => {
        const collections = actor?.collections;
        if (!collections || typeof collections !== 'object' || Array.isArray(collections)) return;
        const keys = Object.keys(collections);
        if (!keys.length || !keys.every(key => ['add', 'remove', 'update'].includes(key))) return;
        if (!keys.every(key => Array.isArray(collections[key]))) return;
        const candidates = (settings.collections || []).filter(col => col.target === 'all' || col.target === target);
        if (candidates.length === 1) actor.collections = { [candidates[0].id]: collections };
        else {
            delete actor.collections;
            warnings.push(`Collection changes for ${target === 'player' ? 'Player' : actor.name || 'NPC'} skipped: missing collection name (${candidates.length} possible collections).`);
        }
    };
    normalize(update.player, 'player');
    if (Array.isArray(update.characters)) update.characters.forEach(actor => normalize(actor, 'npc'));
    return warnings;
}
