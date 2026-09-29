import { getAllCharacters } from '../../characters/character-repository.js';
import { getPlayerCard } from '../status-logic.js';
import { readNpcMemories, cardsWithChangedMemories } from '../npc-memories.js';
import { syncProfileToLore } from '../../lore/lore-sync.js';
import { LOG_PREFIX } from '../../core/constants.js';

/** Sync only profiles or memories changed by a reply switch or removal. */
export function syncRebasedLore(before, after, profileCards = []) {
    const changed = new Set(profileCards);
    for (const card of cardsWithChangedMemories(before, after, getAllCharacters())) changed.add(card);
    try {
        const player = getPlayerCard();
        if (JSON.stringify(before?.player?.memories || [])
            !== JSON.stringify(after?.player?.memories || [])) changed.add(player);
    } catch { /* no persona */ }

    for (const card of changed) {
        const memories = card.isPlayer ? after?.player?.memories : readNpcMemories(after, card);
        syncProfileToLore(card, memories).catch(err =>
            console.error(LOG_PREFIX, 'Could not sync lore after changing reply', err));
    }
}
