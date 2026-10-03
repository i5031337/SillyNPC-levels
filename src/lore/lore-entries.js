import { loadWorldInfo, saveWorldInfo, createWorldInfoEntry } from '../../../../../world-info.js';
import { getContext } from '../../../../../st-context.js';
import { saveSettings } from '../core/settings.js';
import { isChatCharacter } from '../characters/character-repository.js';
import { syncEntryIdentity } from './lorebook.js';
import { createLoreEntryStore } from './lore-entry-store.js';

const create = createLoreEntryStore({
    load: loadWorldInfo, save: saveWorldInfo, allocate: createWorldInfoEntry,
    identify: syncEntryIdentity, persist: saveSettings,
});

/** Reuse a link or an entry previously created for this identity, including after Unlink. */
export function createLoreEntry(card, world, name = card.name) {
    const owner = card.isPlayer
        ? JSON.stringify(['player', card.personaKey || card.name])
        : card.id ? JSON.stringify(['npc', isChatCharacter(card.id)
            ? getContext()?.getCurrentChatId?.() : null, card.id]) : null;
    return create(card, world, name, owner);
}
