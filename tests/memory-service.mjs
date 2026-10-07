import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryService, MEMORY_PROGRESS_KEY } from '../src/memory/memory-service.js';
import { captureMemorySources } from '../src/memory/memory-batch.js';
import { appendMemory, editMemory } from '../src/core/profile-memories.js';
import { readNpcMemories, writeNpcMemories } from '../src/tracker/npc-memories.js';

const reply = (mes = 'Captain joins the adventure') => ({ mes, swipe_id: 0 });
function fixture({ count = 8, eligible = true } = {}) {
    const context = { chat: Array.from({ length: count }, () => reply()), chatMetadata: {}, chatId: 'chat-one' };
    const settings = { enabled: true, activeSystem: 'genre', statusTracker: {
        presets: { genre: { definition: { memories: { enabled: true, interval: 8, guidance: 'Remember promises' } } } },
    } };
    const cards = [{ id: 'captain', name: 'Captain' }];
    const state = { characters: eligible ? [{ name: 'Captain' }] : [], npcMemories: {} };
    if (!eligible) context.chat.forEach(message => { message.mes = 'A quiet day at home'; });
    const rows = new Map();
    const calls = { requests: [], saves: 0, stateSaves: 0, lore: [] };
    let current = context;
    let response = { memories: [] };
    let blocked = false;
    const deps = {
        getContext: () => current, getSettings: () => settings, getCards: () => cards,
        loadState: () => state, saveState: () => { calls.stateSaves++; }, saveChat: () => { calls.saves++; },
        getPending: id => rows.get(id) || [], replacePending: (id, values) => rows.set(id, values),
        enqueue: (id, values) => rows.set(id, [...(rows.get(id) || []), ...values]),
        request: async (...args) => { calls.requests.push(args); return typeof response === 'function' ? response() : response; },
        parse: raw => raw, busy: () => blocked, syncLore: (card, store) => calls.lore.push({ card, store }),
    };
    return { context, settings, cards, state, rows, calls, deps, service: createMemoryService(deps),
        setContext: value => { current = value; }, setResponse: value => { response = value; },
        setBlocked: value => { blocked = value; } };
}
const progress = f => f.context.chatMetadata[MEMORY_PROGRESS_KEY]?.genre;
const proposal = (text, sourceMessageIds = [7]) => ({ npcId: 'captain', text, sourceMessageIds });

test('named speakers and literal NPC aliases make offstage NPCs eligible', async () => {
    for (const mode of ['speaker', 'alias']) {
        const f = fixture({ count: 1, eligible: false });
        f.context.chat[0].mes = mode === 'alias' ? 'Cap promises to return the map.' : 'I promise to return the map.';
        if (mode === 'speaker') f.context.chat[0].name = 'Captain';
        else f.cards[0].aliases = [{ pattern: 'Cap', isRegex: false }];
        f.setResponse({ memories: [proposal('Promised to return the map.', [0])] });
        assert.equal((await f.service.read({ manual: true })).pending, 1);
        assert.equal(f.calls.requests.length, 1);
        if (mode === 'speaker') {
            f.context.chat[0].name = 'Someone else';
            f.service.reconcile();
            assert.equal(f.rows.get(0).length, 0);
            assert.equal(progress(f).checkpoint, -1);
        }
    }
});

test('interval, enablement and host busy gates prevent requests, manual read bypasses interval', async () => {
    const f = fixture({ count: 7 });
    assert.match((await f.service.read()).reason, /Not enough/);
    assert.equal(f.calls.requests.length, 0);
    f.setBlocked(true);
    assert.match((await f.service.read({ manual: true })).reason, /Wait/);
    f.setBlocked(false);
    f.settings.statusTracker.presets.genre.definition.memories.enabled = false;
    assert.match((await f.service.read({ manual: true })).reason, /disabled/);
    f.settings.statusTracker.presets.genre.definition.memories.enabled = true;
    assert.equal((await f.service.read({ manual: true })).ok, true);
    assert.equal(progress(f).checkpoint, 6);
});

test('successful empty pass saves progress and reload does not reread; request failures do not advance', async () => {
    const f = fixture();
    assert.deepEqual(await f.service.read(), { ok: true, pending: 0, messages: 8, remainingReplies: 0 });
    assert.equal(progress(f).checkpoint, 7);
    const reloaded = createMemoryService(f.deps);
    assert.deepEqual(await reloaded.read({ manual: true }), { ok: true, pending: 0, messages: 0 });
    assert.equal(f.calls.requests.length, 1);
    f.context.chat.push(reply('Captain promises to return'));
    f.setResponse(() => { throw new Error('Connection failed'); });
    assert.match((await reloaded.read({ manual: true })).reason, /Connection failed/);
    assert.equal(progress(f).checkpoint, 7);
    assert.equal(reloaded.busy(), false);
    f.setResponse({ wrong: [] });
    assert.match((await reloaded.read({ manual: true })).reason, /memories array/);
    assert.equal(progress(f).checkpoint, 7);
});

test('no eligible NPC segment advances without a model call', async () => {
    const f = fixture({ eligible: false });
    assert.equal((await f.service.read()).ok, true);
    assert.equal(f.calls.requests.length, 0);
    assert.equal(progress(f).checkpoint, 7);
});

test('bounded passes advance only through included replies; remaining backlog awaits cadence or manual reading', async () => {
    const f = fixture();
    f.context.chat.forEach(message => { message.mes = 'Captain ' + 'x'.repeat(10000); });
    const first = await f.service.read();
    assert.equal(first.remainingReplies, 6);
    assert.equal(progress(f).checkpoint, 1);
    assert.equal(JSON.parse(f.calls.requests[0][0]).transcript.length, 2);
    assert.match((await f.service.read()).reason, /Not enough/);
    assert.equal(f.calls.requests.length, 1);
    await f.service.read({ manual: true });
    assert.equal(progress(f).checkpoint, 3);
    f.context.chat[4].mes = 'Captain ' + 'x'.repeat(25000);
    assert.match((await f.service.read({ manual: true })).reason, /exceeds the transcript limit/);
    assert.equal(progress(f).checkpoint, 3);
});

test('proposals dedupe persisted/archive/pending memories and append to existing tracker review rows', async () => {
    const f = fixture();
    const provenance = { systemId: 'genre', sources: captureMemorySources(f.context.chat, [7]) };
    writeNpcMemories(f.state, f.cards[0], appendMemory(['Already remembered'], { text: 'Archived fact' }, 1).store);
    const trackerRow = { kind: 'item-add', actor: 'Captain', label: 'Inventory', item: { Name: 'Map' } };
    const pendingRow = { kind: 'memory-add', cardId: 'captain', after: 'Pending promise', provenance };
    f.rows.set(7, [trackerRow, pendingRow]);
    f.setResponse({ memories: [proposal('Already remembered'), proposal('Archived fact'),
        proposal('Pending promise'), proposal('New promise')] });
    assert.equal((await f.service.read()).pending, 1);
    assert.equal(f.rows.get(7).length, 3);
    assert.deepEqual(f.rows.get(7).slice(0, 2), [trackerRow, pendingRow]);
    assert.equal(f.rows.get(7)[2].after, 'New promise');
});

test('in-flight chat, System, settings and source changes discard results; simultaneous reading is blocked', async () => {
    for (const mutate of [
        f => f.setContext({ ...f.context, chat: [...f.context.chat], chatId: 'chat-two' }),
        f => { f.settings.activeSystem = 'other'; },
        f => { f.settings.statusTracker.presets.genre.definition.memories.guidance = 'Changed genre'; },
        f => { f.context.chat[7].mes = 'Changed source'; },
        f => { f.context.chat[7].swipe_id = 1; },
    ]) {
        const f = fixture();
        let resolve;
        f.setResponse(() => new Promise(done => { resolve = done; }));
        const reading = f.service.read();
        assert.equal(f.service.busy(), true);
        assert.match((await f.service.read()).reason, /already running/);
        mutate(f);
        resolve({ memories: [proposal('A promise')] });
        assert.equal((await reading).ok, false);
        assert.equal(progress(f), undefined);
        assert.equal(f.rows.size, 0);
        assert.equal(f.service.busy(), false);
    }
});

test('reconciliation rewinds processed sources, drops changed proposals and automatic memories, preserving manual entries', async () => {
    const f = fixture();
    const provenance = { systemId: 'genre', sources: captureMemorySources(f.context.chat, [4]) };
    let store = appendMemory([], { text: 'Automatic', provenance }).store;
    store = appendMemory(store, { text: 'Corrected', provenance }).store;
    store = editMemory(store, store.entries[1].id, 'Manually corrected');
    store = appendMemory(store, { text: 'Manual note' }).store;
    writeNpcMemories(f.state, f.cards[0], store);
    await f.service.read();
    f.rows.set(4, [{ kind: 'memory-add', after: 'Stale', provenance }, { kind: 'stat', after: '10' }]);
    f.context.chat[4].mes = 'Changed reply';
    const reloaded = createMemoryService(f.deps);
    reloaded.reconcile();
    assert.equal(progress(f).checkpoint, 3);
    assert.deepEqual(progress(f).sources.map(source => source.messageId), [0, 1, 2, 3]);
    assert.deepEqual(f.rows.get(4), [{ kind: 'stat', after: '10' }]);
    assert.deepEqual(readNpcMemories(f.state, f.cards[0]).entries.map(entry => entry.text),
        ['Manually corrected', 'Manual note']);
    assert.equal(f.calls.stateSaves, 1);
    assert.equal(f.calls.lore.length, 1);
    const before = f.calls.saves;
    reloaded.reconcile();
    assert.equal(f.calls.saves, before);
});
