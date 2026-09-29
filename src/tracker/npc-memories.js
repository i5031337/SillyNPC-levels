import { normalizeMemoryStore } from '../core/profile-memories.js';

function memoryKey(card) {
    return card?.id !== undefined && card?.id !== null
        ? `id:${card.id}` : `name:${String(card?.name ?? '').trim().toLowerCase()}`;
}

function sceneActor(state, card) {
    return state?.characters?.find(item => String(item?.name ?? '').toLowerCase()
        === String(card?.name ?? '').toLowerCase());
}

/** Chat storage survives scene exits. Earlier actor/card memories are read on first use. */
export function readNpcMemories(state, card) {
    const key = memoryKey(card);
    const legacyNameKey = `name:${String(card?.name ?? '').trim().toLowerCase()}`;
    return normalizeMemoryStore(state?.npcMemories?.[key]
        ?? state?.npcMemories?.[legacyNameKey]
        ?? sceneActor(state, card)?.memories
        ?? card?.memories, 500);
}

export function writeNpcMemories(state, card, store) {
    if (!state || !card) return;
    if (!state.npcMemories || typeof state.npcMemories !== 'object') state.npcMemories = {};
    const key = memoryKey(card);
    state.npcMemories[key] = normalizeMemoryStore(store, 500);
    const actor = sceneActor(state, card);
    if (actor) actor.memories = state.npcMemories[key];
    return state.npcMemories[key];
}

/** NPCs whose lore memory section must change after a reply rebase. */
export function cardsWithChangedMemories(before, after, cards) {
    return cards.filter(card => JSON.stringify(readNpcMemories(before, card))
        !== JSON.stringify(readNpcMemories(after, card)));
}
