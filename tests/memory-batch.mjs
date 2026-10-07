import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMemoryBatch, validateMemoryResponse, captureMemorySources, isMemoryAssistantReply }
    from '../src/memory/memory-batch.js';
import { appendMemory, editMemory, invalidateMemoryStore, memorySourcesMatch, normalizeMemoryStore }
    from '../src/core/profile-memories.js';

const user = mes => ({ mes, is_user: true });
const reply = mes => ({ mes, swipe_id: 0 });
const cards = [{ id: 'captain', name: 'Captain', memories: ['Owes a favor'] }];

test('oldest unread replies are bounded, include user evidence, and retain context separately', () => {
    const messages = [user('Before'), reply('Old reply'), user('Promise'), reply('Accepted promise'),
        user('Later question'), reply('Later answer')];
    const batch = buildMemoryBatch(messages, 1, { maxChars: 220 });
    assert.equal(batch.checkpoint, 3);
    assert.equal(batch.unreadReplies, 2);
    assert.deepEqual(batch.unreadMessageIds, [2, 3]);
    assert.deepEqual(batch.messages.map(message => message.id), [2, 3]);
    const next = buildMemoryBatch(messages, 3);
    assert.deepEqual(next.messages.map(message => [message.id, message.unread]),
        [[2, false], [3, false], [4, true], [5, true]]);
    assert.equal(buildMemoryBatch(messages, 5), null);
});

test('oversized oldest segment fails rather than skipping unseen evidence', () => {
    assert.throws(() => buildMemoryBatch([reply('X'.repeat(500))], -1, { maxChars: 200 }), /exceeds/);
    assert.throws(() => buildMemoryBatch([user('X'.repeat(100)), reply('Y'.repeat(100))], -1,
        { maxChars: 300 }), /exceeds/);
});

test('completed narrative replies count, system, streaming and image-only replies do not', () => {
    for (const message of [user('Hello'), { mes: 'System', is_system: true },
        { mes: 'Partial', is_streaming: true }, { mes: '<img src="picture">' },
        { mes: 'Picture', extra: { inline_image: false, media: ['picture'] } }]) {
        assert.equal(isMemoryAssistantReply(message), false);
    }
    assert.equal(isMemoryAssistantReply(reply('NPC spoke')), true);
});

test('memory proposals require known NPCs, unread evidence, and dedupe active, archived and pending', () => {
    const messages = [reply('Earlier'), user('Offers promise'), reply('Captain agrees')];
    const batch = buildMemoryBatch(messages, 0);
    const candidate = (text, npcId = 'captain', sourceMessageIds = [2]) => ({ npcId, text, sourceMessageIds });
    const rows = validateMemoryResponse({ memories: [candidate('Owes a favor'), candidate('Pending'),
        candidate('Unknown', 'nobody'), candidate('Context only', 'captain', [0]),
        candidate('Missing evidence', 'captain', [99]), candidate('New promise'),
        candidate(' new  PROMISE '), candidate('Second'), candidate('Third'), candidate('Fourth')] },
    { cards, batch, pending: [{ kind: 'memory-add', cardId: 'captain', after: 'Pending' }], systemId: 'genre' });
    assert.deepEqual(rows.map(row => row.after), ['New promise', 'Second', 'Third']);
    assert.equal(rows[0].kind, 'memory-add');
    assert.equal(rows[0].actor, 'Captain');
    assert.equal(rows[0].provenance.systemId, 'genre');
    assert.equal(rows[0].id, validateMemoryResponse({ memories: [candidate('New promise')] },
        { cards, batch, systemId: 'genre' })[0].id);
    assert.throws(() => validateMemoryResponse({}), /memories array/);
});

test('source changes remove automatic active and archived memories but retain manual corrections', () => {
    const messages = [user('Promise'), reply('Accepted')];
    const provenance = { systemId: 'system', chatId: 'chat', sources: captureMemorySources(messages, [0, 1]) };
    let store = appendMemory([], { text: 'Promise accepted', provenance }, 1).store;
    store = appendMemory(store, { text: 'Remembered twice', provenance }, 1).store;
    store = appendMemory(store, { text: 'User note' }, 1).store;
    const corrected = editMemory(store, store.archive[0].id, 'Corrected promise');
    assert.deepEqual(normalizeMemoryStore(corrected, 500), corrected);
    assert.equal(corrected.archive[0].provenance.chatId, 'chat');
    messages[1].swipe_id = 1;
    assert.equal(memorySourcesMatch(messages, provenance.sources), false);
    const result = invalidateMemoryStore(corrected, messages);
    assert.deepEqual(result.removed.map(entry => entry.text), ['Remembered twice']);
    assert.deepEqual(result.store.archive.map(entry => entry.text), ['Corrected promise']);
    assert.deepEqual(result.store.entries.map(entry => entry.text), ['User note']);
    assert.equal(result.rewindTo, 0);
    messages[0].mes = 'Different promise';
    assert.equal(invalidateMemoryStore(store, messages).rewindTo, -1);
});

test('deleted or reordered supporting replies invalidate compact sources without storing transcripts', () => {
    const messages = [reply('First'), reply('Second')];
    const sources = captureMemorySources(messages, [0, 1]);
    assert.equal(Object.hasOwn(sources[0], 'text'), false);
    assert.equal(memorySourcesMatch(messages, sources), true);
    assert.equal(memorySourcesMatch([messages[1]], sources), false);
});
