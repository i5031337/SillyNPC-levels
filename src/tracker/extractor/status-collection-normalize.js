import { proposedNpcTemplate } from '../../core/npc-templates.js';
import { collectionAppliesTo } from '../../core/collection-targets.js';
/** Repair an omitted collection ID only when the actor has one possible destination. */
export function normalizeCollectionUpdates(update, settings, state = null, cards = []) {
    const warnings = [];
    const normalize = (actor, target) => {
        const collections = actor?.collections;
        if (!collections || typeof collections !== 'object' || Array.isArray(collections)) return;
        const keys = Object.keys(collections);
        if (!keys.length || !keys.every(key => ['add', 'remove', 'update'].includes(key))) return;
        if (!keys.every(key => Array.isArray(collections[key]))) return;
        const current = state?.characters?.find(entry => entry.name?.toLowerCase() === actor.name?.toLowerCase())
            || cards.find(entry => entry.name?.toLowerCase() === actor.name?.toLowerCase());
        const selected = target === 'npc' ? proposedNpcTemplate(current || {}, actor) : null;
        const owner = selected ? { npcTemplateId: selected.id } : actor;
        const candidates = (settings.collections || []).filter(col => collectionAppliesTo(col, target, owner));
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
