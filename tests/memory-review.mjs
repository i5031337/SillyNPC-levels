import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMemoryReviewRows, applyReviewedMemories, mergePendingMemoryRows } from '../src/memory/memory-review.js';
import { captureMemorySources } from '../src/memory/memory-batch.js';
import { readNpcMemories } from '../src/tracker/npc-memories.js';
import { readFile } from 'node:fs/promises';

const messages = [{ mes: 'Ada promised to guard the bridge.', is_user: false, swipe_id: 1 }];
const cards = [{ id: 'ada', name: 'Ada' }, { id: 'bea', name: 'Bea' }];
const proposal = (id, after) => ({ id, kind: 'memory-add', scope: 'character', actor: 'Ada',
    cardId: 'ada', label: 'Memory', after,
    provenance: { systemId: 'fantasy', chatId: 'chat-a', sources: captureMemorySources(messages, [0]) } });
const options = { messages, systemId: 'fantasy', chatId: 'chat-a', limit: 1 };

test('review selects individual memories while edits cannot change their owner or evidence', () => {
    const one = proposal('one', 'Promised to guard the bridge');
    const two = proposal('two', 'Met the bridge keeper');
    const selected = selectMemoryReviewRows([one, two], [{ ...two, after: 'Met the keeper',
        cardId: 'bea', provenance: {} }, { ...two, after: 'Duplicate selection' },
        proposal('unknown', 'Injected memory')]);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].id, 'two');
    assert.equal(selected[0].cardId, 'ada');
    assert.deepEqual(selected[0].provenance, two.provenance);
    assert.equal(selected[0].after, 'Met the keeper');
    assert.equal(selected[0].editedManually, true);
    assert.deepEqual(selectMemoryReviewRows([one], [{ ...one, after: '  ' }]), []);
});

test('review writes chat-local memories for NPCs outside the scene, with capacity and deduplication', () => {
    const state = { characters: [] };
    const one = proposal('one', 'Promised to guard the bridge');
    const two = proposal('two', 'Met the bridge keeper');
    const result = applyReviewedMemories(state, [one, two, { ...one, after: '  PROMISED to guard the bridge ' }], cards, options);
    assert.equal(result.applied, 2);
    assert.equal(result.changed.length, 1);
    const store = readNpcMemories(state, cards[0]);
    assert.equal(store.entries[0].text, two.after);
    assert.equal(store.archive[0].text, one.after);
    assert.deepEqual(store.archive[0].provenance, one.provenance);
    assert.equal(cards[0].memories, undefined);
});

test('review rejects stale swipes, edits, chats, Systems, missing cards, and missing evidence', () => {
    const row = proposal('one', 'Promised to guard the bridge');
    for (const override of [
        { messages: [{ ...messages[0], swipe_id: 2 }] },
        { messages: [{ ...messages[0], mes: 'Ada left.' }] },
        { messages: [] }, { chatId: 'chat-b' }, { systemId: 'mystery' },
    ]) {
        const state = { characters: [] };
        assert.equal(applyReviewedMemories(state, [row], cards, { ...options, ...override }).applied, 0);
        assert.equal(state.npcMemories, undefined);
    }
    assert.equal(applyReviewedMemories({}, [row], [], options).applied, 0);
    assert.equal(applyReviewedMemories({}, [{ ...row, provenance: { systemId: 'fantasy', sources: [] } }], cards, options).applied, 0);
});

test('tracker replacement preserves memory review; resolving and invalidating can explicitly replace it', () => {
    const memory = proposal('one', 'Promised to guard the bridge');
    const tracker = { kind: 'stat', after: '7' };
    assert.deepEqual(mergePendingMemoryRows([memory, { kind: 'stat' }], [tracker]), [tracker, memory]);
    assert.deepEqual(mergePendingMemoryRows([memory], []), [memory]);
    assert.deepEqual(mergePendingMemoryRows([memory], [tracker], true), [tracker]);
    assert.deepEqual(mergePendingMemoryRows([memory], [memory]), [memory]);
});

test('review resolver saves and syncs memory batches without creating narrator turn effects', async () => {
    const row = proposal('one', 'Promised to guard the bridge');
    const message = { ...messages[0], extra: { sillynpc_pending: [row] } };
    const state = { characters: [] };
    const saves = [], synced = [];
    const context = { chat: [message], getCurrentChatId: () => 'chat-a' };
    const deps = {
        getContext: () => context,
        getSettings: () => ({ activeSystem: 'fantasy', statusTracker: {} }),
        getAllCharacters: () => cards, debugLog: () => {}, eventSource: { emit() {} },
        loadStateFromMetadata: () => state, saveStateToMetadata: (_state, options) => saves.push(options),
        getCurrentPersonaKey: () => 'player', saveChatSoon: () => {},
        applyUpdate: () => { throw new Error('Memories must bypass tracker updates'); },
        buildUpdateFromChanges: () => { throw new Error('Memories must bypass tracker diffs'); },
        recordAppliedChanges: () => { throw new Error('Memories must bypass narrator turn effects'); },
        appliedChangesForCurrentSwipe: () => [],
        selectReviewRows: () => ({ rows: [], rejectedTransitions: new Set() }),
        validateReviewedTransitions: () => ({ rows: [], invalid: new Set() }),
        materializeGrantRows: () => ({ rows: [] }),
        activeNpcSystem: () => ({ memories: { enabled: true, maxEntriesPerCharacter: 50 } }),
        syncProfileToLore: async (card, store, options) => synced.push({ card, store, current: options.isCurrent() }),
        selectMemoryReviewRows, applyReviewedMemories, mergePendingMemoryRows,
    };
    const source = await readFile(new URL('../src/tracker/status-review.js', import.meta.url), 'utf8');
    const resolve = new Function(...Object.keys(deps), source.replace(/^import .*;\n/gm, '').replace(/export /g, '')
        + '\nreturn resolvePendingChanges;')(...Object.values(deps));
    const result = resolve(0, [{ ...row, after: 'A corrected promise' }]);
    assert.equal(result.applied, 1);
    assert.equal(message.extra.sillynpc_pending, undefined);
    assert.equal(saves.length, 1);
    assert.equal(saves[0].partOfMessage, undefined);
    assert.equal(synced.length, 1);
    assert.equal(synced[0].current, true);
    assert.equal(readNpcMemories(state, cards[0]).entries[0].editedManually, true);
    assert.equal(resolve(0, [row]).applied, 0);
});
