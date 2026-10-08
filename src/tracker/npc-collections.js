import { getAllCharacters } from '../characters/character-repository.js';
import { saveSettings } from '../core/settings.js';

/** Save scene belongings on cards so they survive departure. */
export function syncNpcCollectionsToCards(actors) {
    const cards = getAllCharacters();
    let changed = false;
    for (const actor of actors) {
        const card = cards.find(card => actor.id && card.id === actor.id)
            || cards.find(card => card.name?.toLowerCase() === actor.name?.toLowerCase());
        if (!card || !actor.collections) continue;
        if (JSON.stringify(card.statusCollections || {}) === JSON.stringify(actor.collections)) continue;
        card.statusCollections = structuredClone(actor.collections);
        changed = true;
    }
    if (changed) saveSettings();
    return changed;
}
