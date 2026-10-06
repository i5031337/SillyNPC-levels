import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

function source(path) {
    return readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replace(/^export \{[^}]*\};\s*/gm, '').replaceAll('export ', '');
}
const scanSource = source('../src/story/history-scan.js');
const diffSource = source('../src/tracker/status-diff-compare.js');
const computeStateDiff = new Function('activeNpcSystem', 'npcTemplateFor', 'splitValue',
    `${diffSource}\nreturn computeStateDiff;`)(() => null, () => null, value => ({ current: String(value ?? ''), max: '' }));
const { stripStats, mergeFindings } = new Function(`${scanSource}\nreturn { stripStats, mergeFindings };`)();
const settings = { collections: [{ id: 'items', fields: [{ name: 'name', isPrimary: true }] }],
    scanCharBudget: 1000, scanDepth: 0, reviewMode: 'off' };

function harness({ chat = [], state = { player: { name: 'Player', collections: {} }, characters: [] }, replies = [], cards = [], decided = () => false } = {}) {
    const prompts = [], pending = [], updates = [];
    let requests = 0;
    const bindings = {
        collectionAppliesTo: () => true, npcTemplates: () => [], getAllCharacters: () => cards,
        promptText: (id, values) => id === 'scanRequest' ? JSON.stringify(values) : id,
        getContext: () => ({ chat }), getSettings: () => ({ enabled: true, statusTracker: settings }),
        LOG_PREFIX: 'test', debugLog: () => {}, loadStateFromMetadata: () => state,
        requestExtraction: async prompt => { prompts.push(JSON.parse(prompt)); const reply = replies[requests++]; if (reply instanceof Error) throw reply; return reply; },
        coerceToUpdate: raw => raw, describeCollections: () => 'items', computeStateDiff,
        applyUpdate: (update, options) => {
            updates.push(options);
            const next = structuredClone(state);
            for (const character of update.characters) {
                if (!next.characters.some(c => c.name.toLowerCase() === character.name.toLowerCase())) {
                    const card = cards.find(c => c.name.toLowerCase() === character.name.toLowerCase());
                    if (card) next.characters.push({ name: card.name, collections: structuredClone(card.statusCollections || {}) });
                }
            }
            mergeFindings(next, update, settings);
            return next;
        },
        partitionChanges: changes => ({ pending: changes }), setPendingChanges: (index, changes) => pending.push(...changes),
        isItemDecided: decided, getItemRules: () => ({}), DISMISSED_KEY: 'dismissed', PLAYER_ACTOR: 'player',
    };
    const api = new Function(...Object.keys(bindings), `${scanSource}\nreturn { scanHistoryForCollections, collectHistoryChunks, estimateScan };`)(...Object.values(bindings));
    return { ...api, prompts, pending, updates, get requests() { return requests; } };
}
const twoChunks = [{ mes: 'a'.repeat(700) }, { mes: 'b'.repeat(700) }];
const inventory = items => ({ player: { collections: { items } } });

test('history scan retains template assignments and replaces explicit inventories', () => {
    const stripped = stripStats({ player: { stats: { HP: '100' }, collections: { items: [] } },
        characters: [{ name: 'Mira', npcTemplateId: 'scout', stats: { HP: '100' }, collections: { items: [{ name: 'Compass' }] } }] });
    assert.equal('stats' in stripped.characters[0], false);
    assert.equal('stats' in stripped.player, false);
    const merged = { player: { collections: {} }, characters: [] };
    mergeFindings(merged, stripped);
    mergeFindings(merged, stripStats({ characters: [{ name: 'Mira', collections: { items: [{ name: 'Map' }] } }] }));
    assert.equal(merged.characters[0].npcTemplateId, 'scout');
    assert.deepEqual(merged.characters[0].collections.items, [{ name: 'Map' }]);
});

test('omissions preserve inventory, explicit empty clears it, duplicate identities coalesce', () => {
    const merged = { player: { collections: { items: [{ name: 'Potion' }], skills: [{ name: 'Heal' }] } }, characters: [{ name: 'Mira', collections: { items: [{ name: 'Map' }] } }] };
    mergeFindings(merged, inventory([{ name: 'Sword', quantity: 1 }, { name: ' sword ', quantity: 2 }]));
    assert.equal(merged.player.collections.items.length, 1);
    assert.equal(merged.player.collections.items[0].quantity, 2);
    assert.deepEqual(merged.player.collections.skills, [{ name: 'Heal' }]);
    assert.deepEqual(merged.characters[0].collections.items, [{ name: 'Map' }]);
    mergeFindings(merged, inventory([]));
    assert.deepEqual(merged.player.collections.items, []);
});

test('acquire then sell or consume across passes does not resurrect items or save changes', async () => {
    for (const initial of [[], [{ name: 'Sword' }]]) {
        const state = { player: { name: 'Player', collections: { items: initial } }, characters: [] };
        const original = structuredClone(state);
        const h = harness({ chat: twoChunks, state, replies: [inventory([{ name: 'Sword', quantity: 1 }]), inventory([])] });
        const result = await h.scanHistoryForCollections();
        assert.equal(result.ok, true);
        assert.match(h.prompts[1].recorded, /Sword/);
        assert.match(h.prompts[1].recorded, /quantity/);
        assert.deepEqual(h.pending.map(row => row.kind), initial.length ? ['item-remove'] : []);
        assert.deepEqual(state, original);
        assert.equal(h.updates[0].dryRun, true);
        assert.equal(h.updates[0].allowReplace, true);
    }
});

test('unmentioned earlier items survive and transfers propose both actor changes', async () => {
    const state = { player: { name: 'Player', collections: { items: [{ name: 'Sword' }] } }, characters: [] };
    const h = harness({ chat: twoChunks, state, cards: [{ name: 'Mira', statusCollections: { items: [{ name: 'Map' }] } }], replies: [inventory([{ name: 'Sword' }, { name: 'Potion' }]),
        { player: { collections: { items: [{ name: 'Potion' }] } }, characters: [{ name: 'Mira', collections: { items: [{ name: 'Map' }, { name: 'Sword' }] } }] }] });
    assert.equal((await h.scanHistoryForCollections()).ok, true);
    assert.match(h.prompts[0].recorded, /Map/);
    assert.deepEqual(h.pending.map(row => [row.actor, row.kind, row.label]), [[null, 'item-remove', 'Sword'], [null, 'item-add', 'Potion'], ['Mira', 'item-add', 'Sword']]);
});

test('standing item decisions filter scan additions and removals', async () => {
    const h = harness({ chat: [{ mes: 'changed' }], state: { player: { collections: { items: [{ name: 'Protected' }] } }, characters: [] },
        replies: [inventory([{ name: 'Dismissed' }])], decided: () => true });
    assert.equal((await h.scanHistoryForCollections()).pending, 0);
    assert.deepEqual(h.pending, []);
});

test('failed intermediate and final passes stop the scan without partial proposals', async () => {
    for (const failedIndex of [0, 1, 2]) {
        const replies = [inventory([{ name: 'Sword' }]), inventory([]), inventory([])];
        replies[failedIndex] = failedIndex === 1 ? null : new Error('network error');
        const h = harness({ chat: [...twoChunks, { mes: 'c'.repeat(700) }], replies });
        const result = await h.scanHistoryForCollections();
        assert.equal(result.ok, false);
        assert.match(result.reason, /No inventory changes were proposed/);
        assert.equal(h.requests, failedIndex + 1);
        assert.equal(h.updates.length, 0);
        assert.deepEqual(h.pending, []);
    }
});

test('oversized messages stop before requests and estimates explain speaker-label budget', async () => {
    for (const chat of [[{ mes: 'x'.repeat(1000) }], [{ mes: 'x'.repeat(1000) }, { mes: 'normal' }], [{ mes: 'normal' }, { mes: 'x'.repeat(1000) }], [{ mes: 'x'.repeat(2000) }, { mes: 'y'.repeat(2000) }]]) {
        const h = harness({ chat });
        assert.throws(() => h.collectHistoryChunks(settings), /speaker label/);
        assert.match(h.estimateScan(settings).error, /No requests were made/);
        const result = await h.scanHistoryForCollections();
        assert.equal(result.ok, false);
        assert.equal(h.requests, 0);
    }
});

test('exact transcript budgets include labels and separators, chunks retain chronological order', () => {
    const h = harness({ chat: [{ mes: 'a'.repeat(989) }] });
    assert.equal(h.collectHistoryChunks(settings)[0].chars, 1000);
    const pair = harness({ chat: [{ mes: 'a'.repeat(488) }, { mes: 'b'.repeat(488) }] });
    const chunks = pair.collectHistoryChunks(settings);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chars, chunks[0].text.length);
    assert.equal(chunks[0].chars, 1000);
    const limited = harness({ chat: [...twoChunks, { mes: 'c'.repeat(700) }] });
    const kept = limited.collectHistoryChunks({ ...settings, scanMaxChunks: 2 });
    assert.equal(kept.length, 2);
    assert.match(kept[0].text, /bbb/);
    assert.match(kept[1].text, /ccc/);
    assert.ok(kept.every(chunk => chunk.text.length <= 1000));
});

test('unchanged passes may omit all inventories without discarding earlier findings', async () => {
    for (const unchanged of [{ player: { collections: {} } }, { characters: [] }]) {
        const h = harness({ chat: twoChunks, replies: [inventory([{ name: 'Sword' }]), unchanged] });
        const result = await h.scanHistoryForCollections();
        assert.equal(result.ok, true);
        assert.deepEqual(h.pending.map(row => [row.kind, row.label]), [['item-add', 'Sword']]);
    }
});

test('offstage inventory can be emptied and omissions retain its prior inventory', async () => {
    const h = harness({ chat: twoChunks, cards: [{ name: 'Mira', npcTemplateId: 'scout', statusCollections: { items: [{ name: 'Potion' }] } }],
        replies: [{ characters: [{ name: 'Mira', collections: { items: [] } }] }, { player: { collections: {} } }] });
    assert.equal((await h.scanHistoryForCollections()).ok, true);
    assert.deepEqual(h.pending.map(row => [row.actor, row.kind, row.label]), [['Mira', 'item-remove', 'Potion']]);
    assert.match(h.prompts[1].recorded, /Mira/);
    assert.match(h.prompts[1].recorded, /items: \[\]/);
});

test('duplicate names use the configured primary field', () => {
    const merged = { player: { collections: {} }, characters: [] };
    mergeFindings(merged, inventory([{ title: 'Sword', quantity: 1 }, { title: 'sword', quantity: 2 }]),
        { collections: [{ id: 'items', fields: [{ name: 'title', isPrimary: true }] }] });
    assert.deepEqual(merged.player.collections.items, [{ title: 'sword', quantity: 2 }]);
});
