import { normalizeMemoryStore, memoryTextFingerprint } from '../core/profile-memories.js';

const cleanText = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const textKey = value => cleanText(value).toLocaleLowerCase();

export function isMemoryAssistantReply(message) {
    return Boolean(message && !message.is_user && !message.is_system
        && !message.is_streaming && !message.isStreaming && message.completed !== false
        && !(message.extra?.inline_image === false && message.extra?.media?.length)
        && String(message.mes ?? '').replace(/<img\b[^>]*>/gi, '').trim());
}

export function captureMemorySources(messages, ids) {
    return [...new Set(ids)].filter(id => Number.isSafeInteger(id) && messages?.[id])
        .map(messageId => ({ messageId, swipeId: Number(messages[messageId].swipe_id ?? 0),
            fingerprint: memoryTextFingerprint(messages[messageId].mes), isUser: Boolean(messages[messageId].is_user),
            ...(messages[messageId].name ? { speaker: String(messages[messageId].name) } : {}) }));
}

/** Process the oldest unread segment first, never advancing past omitted text. */
export function buildMemoryBatch(messages = [], checkpoint = -1, { maxChars = 24000, overlap = 2 } = {}) {
    const start = Number.isSafeInteger(checkpoint) ? Math.max(-1, checkpoint) : -1;
    const replyIds = messages.map((message, id) => id > start && isMemoryAssistantReply(message) ? id : -1)
        .filter(id => id >= 0);
    if (!replyIds.length) return null;
    const budget = Math.max(100, Number(maxChars) || 24000);
    let end = replyIds[0];
    let chars = 0;
    for (let id = start + 1; id < messages.length; id++) {
        const message = messages[id];
        if (!message || message.is_system) continue;
        const size = String(message.mes ?? '').length + 80;
        if (chars + size > budget) {
            if (id <= replyIds[0]) throw new Error('The oldest unread memory segment exceeds the transcript limit. Shorten those messages before reading memories.');
            break;
        }
        chars += size;
        if (isMemoryAssistantReply(message)) end = id;
        if (chars >= budget && id >= replyIds[0]) break;
    }
    const unreadMessageIds = [];
    for (let id = start + 1; id <= end; id++) {
        if (messages[id] && !messages[id].is_system) unreadMessageIds.push(id);
    }
    const contextIds = [];
    for (let id = start; id >= 0 && contextIds.length < overlap; id--) {
        if (messages[id] && !messages[id].is_system) contextIds.unshift(id);
    }
    // Context consumes only the budget left by new messages.
    const rawUnreadChars = unreadMessageIds.reduce((sum, id) => sum + String(messages[id].mes ?? '').length + 80, 0);
    let remainingContext = Math.max(0, budget - rawUnreadChars);
    const includedContext = contextIds.filter(id => {
        const size = String(messages[id].mes ?? '').length + 80;
        if (size > remainingContext) return false;
        remainingContext -= size;
        return true;
    });
    const ids = [...includedContext, ...unreadMessageIds];
    const transcript = ids.map(id => {
        const message = messages[id];
        const text = String(message.mes ?? '');
        return { id, role: message.is_user ? 'player' : 'narrator',
            speaker: String(message.name || (message.is_user ? 'Player' : 'Narrator')).slice(0, 100),
            text, unread: id > start };
    });
    return { messages: transcript, sources: captureMemorySources(messages, ids), unreadMessageIds,
        checkpoint: end, unreadReplies: replyIds.length,
        replyCount: replyIds.filter(id => id <= end).length };
}

/** Model output is untrusted: unknown NPCs and unsupported/duplicate memories are rejected. */
export function validateMemoryResponse(payload, { cards = [], batch, pending = [], systemId = '', chatId } = {}) {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.memories)) {
        throw new Error('Memory reader response must contain a memories array.');
    }
    const actors = new Map(cards.filter(card => card && !card.isPlayer)
        .map(card => [String(card.id), card]));
    const known = new Map([...actors].map(([id, card]) => [id, new Set([
        ...normalizeMemoryStore(card.memories, 500).entries,
        ...normalizeMemoryStore(card.memories, 500).archive,
        ...pending.filter(row => row.kind === 'memory-add' && String(row.cardId) === id)
            .map(row => ({ text: row.after })),
    ].map(entry => textKey(entry.text)))]));
    const rows = [];
    const counts = new Map();
    const unread = new Set(batch?.unreadMessageIds || []);
    const sources = new Map((batch?.sources || []).map(source => [source.messageId, source]));
    for (const candidate of payload.memories) {
        if (!candidate || typeof candidate !== 'object') continue;
        const npcId = String(candidate.npcId ?? '');
        const card = actors.get(npcId);
        if (!card || (counts.get(npcId) || 0) >= 3 || typeof candidate.text !== 'string') continue;
        const text = cleanText(candidate.text);
        if (!text || text.length > 600 || known.get(npcId).has(textKey(text))) continue;
        const ids = candidate.sourceMessageIds;
        if (!Array.isArray(ids) || !ids.length || !ids.every(id => Number.isSafeInteger(id) && sources.has(id))
            || !ids.some(id => unread.has(id))) continue;
        known.get(npcId).add(textKey(text));
        counts.set(npcId, (counts.get(npcId) || 0) + 1);
        rows.push({ kind: 'memory-add', scope: 'character', actor: card.name, cardId: card.id,
            id: `memory-${memoryTextFingerprint(`${systemId}|${npcId}|${text}|${JSON.stringify(ids.map(id => sources.get(id)))}`)}`,
            label: 'Memory', before: '', after: text, risk: 'risky', reason: 'New NPC memory',
            note: `Supporting message${ids.length > 1 ? 's' : ''}: ${[...new Set(ids)].map(id => id + 1).join(', ')}`,
            provenance: { systemId: String(systemId), ...(chatId !== undefined ? { chatId: String(chatId) } : {}),
                sources: [...new Set(ids)].map(id => ({ ...sources.get(id) })) } });
    }
    return rows;
}
