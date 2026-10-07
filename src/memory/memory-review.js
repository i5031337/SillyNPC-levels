import { appendMemory, memorySourcesMatch, normalizeMemorySources } from '../core/profile-memories.js';
import { readNpcMemories, writeNpcMemories } from '../tracker/npc-memories.js';

/** Review may edit text, but cannot redirect ownership or replace source evidence. */
export function selectMemoryReviewRows(pending, accepted) {
    const seen = new Set();
    const rows = [];
    for (const incoming of accepted || []) {
        if (incoming.kind !== 'memory-add' || !incoming.id || seen.has(incoming.id)) continue;
        const original = pending.find(row => row.kind === 'memory-add' && row.id === incoming.id);
        if (!original) continue;
        seen.add(incoming.id);
        const after = String(incoming.after ?? '').trim();
        if (after) rows.push({ ...original, after,
            ...(after !== String(original.after).trim() ? { editedManually: true } : {}) });
    }
    return rows;
}

/** Apply only still-current proposals; callers save once and sync the changed cards. */
export function applyReviewedMemories(state, rows, cards, { messages, systemId, chatId, limit } = {}) {
    let applied = 0;
    const changed = new Map();
    for (const row of rows) {
        const provenance = row.provenance;
        const sources = normalizeMemorySources(provenance?.sources);
        if (row.cardId == null || !provenance || provenance.systemId !== systemId || !sources.length
            || (provenance.chatId !== undefined && provenance.chatId !== String(chatId))
            || !memorySourcesMatch(messages, sources)) continue;
        const card = cards.find(candidate => String(candidate.id) === String(row.cardId));
        if (!card || card.isPlayer) continue;
        const result = appendMemory(readNpcMemories(state, card), {
            text: row.after, provenance,
            ...(row.editedManually ? { editedManually: true } : {}),
        }, limit);
        if (!result.added) continue;
        writeNpcMemories(state, card, result.store);
        changed.set(card.id, { card, store: result.store });
        applied++;
    }
    return { applied, changed: [...changed.values()] };
}

/** Tracker replacement must leave independently proposed memory batches pending. */
export function mergePendingMemoryRows(pending, changes, replaceMemory = false) {
    const incoming = Array.isArray(changes) ? changes : [];
    if (replaceMemory) return incoming;
    const ids = new Set(incoming.filter(row => row.kind === 'memory-add').map(row => row.id));
    return [...incoming, ...(pending || []).filter(row => row.kind === 'memory-add' && !ids.has(row.id))];
}
