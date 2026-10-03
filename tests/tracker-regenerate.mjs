import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeCollectionUpdates } from '../src/tracker/extractor/status-collection-normalize.js';
import { diffTurnValues, applyTurnValues, turnEffectStatus } from '../src/tracker/snapshots/status-turn-delta.js';
import { expandNumericDeltas } from '../src/tracker/extractor/status-extractor-deltas.js';

const settings = { enabled: true, extractionMode: 'extract', collections: [
    { id: 'inventory', target: 'player' }, { id: 'abilities', target: 'npc' },
] };
test('unnamed collections use the single collection applicable to each actor', () => {
    const update = { player: { collections: { add: [{ name: 'Key' }], remove: ['Coin'] } },
        characters: [{ name: 'Ada', collections: { update: [{ name: 'Sneak' }] } }] };
    assert.deepEqual(normalizeCollectionUpdates(update, settings), []);
    assert.deepEqual(update.player.collections.inventory, { add: [{ name: 'Key' }], remove: ['Coin'] });
    assert.deepEqual(update.characters[0].collections.abilities, { update: [{ name: 'Sneak' }] });
});
test('ambiguous collections are skipped with a visible explanation; named ones stay intact', () => {
    const update = { player: { collections: { add: [] } } };
    const warnings = normalizeCollectionUpdates(update, { collections: [
        ...settings.collections, { id: 'spells', target: 'all' },
    ] });
    assert.match(warnings[0], /missing collection name \(2 possible collections\)/);
    assert.equal(update.player.collections, undefined);
    const named = { player: { collections: { inventory: { add: [] } } } };
    const original = structuredClone(named);
    normalizeCollectionUpdates(named, settings);
    assert.deepEqual(named, original);
});

function loadModule(path, deps) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replaceAll('export ', '');
    return new Function(...Object.keys(deps), `${source}\nreturn typeof extractStateFromMessage === 'function'
        ? { extractStateFromMessage } : { replacementReadingState, revertToBase };`)(...Object.values(deps));
}
function harness(mode = 'extract') {
    const baseState = { player: { stats: { XP: '10', HP: '100' } } };
    let live = { player: { stats: { XP: '30', HP: '95' } } };
    const base = { messageId: '0', state: baseState, profiles: {},
        applied: { state: { player: { stats: { XP: '30', HP: '100' } } }, profiles: {} } };
    const message = { mes: 'You earned experience.', extra: { sillynpc_applied: [{ old: true }] } };
    const context = { chat: [message] };
    let pending = [{ old: true }];
    let response = { player: { stats: {}, deltas: { XP: 20 } } };
    let onRequest = () => {};
    let prompted;
    const deps = {
        getContext: () => context, swipeBaseRecord: () => base,
        getSwipeBase: id => String(id) === base.messageId ? structuredClone(base.state) : null,
        loadStateFromMetadata: () => live, snapshotProfiles: () => ({}),
        restoreProfiles: () => [], saveStateToMetadata: state => { live = structuredClone(state); },
        diffTurnValues, applyTurnValues, turnEffectStatus, syncRebasedLore: () => {}, debugLog: () => {},
    };
    const snapshots = loadModule('../src/tracker/snapshots/status-snapshot-swipe.js', deps);
    const extraction = loadModule('../src/tracker/extractor/status-extractor-run.js', {
        ...deps, ...snapshots, normalizeCollectionUpdates,
        trackerMessageIndex: chat => chat.length - 1,
        getSettings: () => ({ statusTracker: { ...settings, extractionMode: mode,
            playerStats: [{ name: 'XP', purpose: 'xp' }] } }),
        rememberSwipeBase: () => {},
        refreshTurnBase: () => { base.beforeApply = { state: structuredClone(live), profiles: {} }; },
        sanitizeModelUpdate: () => {}, reconcileScenePresence: () => {},
        applyUpdate: (parsed, options) => {
            const result = structuredClone(live);
            Object.assign(result.player.stats, parsed.player?.stats || {});
            if (!options?.dryRun) live = result;
            return result;
        },
        takeRefusedValues: () => [], computeStateDiff: (before, after) =>
            before.player.stats.XP === after.player.stats.XP ? [] : [{ label: 'XP', after: after.player.stats.XP }],
        partitionChanges: changes => ({ auto: changes, pending: [] }),
        buildUpdateFromChanges: () => ({}), attachReasons: () => [],
        setPendingChanges: (id, rows) => { pending = rows; }, isItemDecided: () => false,
        recordAppliedChanges: (id, rows) => {
            message.extra.sillynpc_applied = (message.extra.sillynpc_applied || []).concat(rows);
            base.applied = { state: applyTurnValues(base.state, diffTurnValues(base.beforeApply.state, live)), profiles: {} };
        },
        applyTimeRules: () => ({ rows: [] }), setStrangerKinds: () => false,
        triggerReprocess: () => {}, buildExtractionSchema: () => ({}), strangersToClassify: () => [],
        buildUserPrompt: state => { prompted = structuredClone(state); return ''; }, collectLeadUp: () => '',
        requestExtraction: async () => { await onRequest(); return structuredClone(response); },
        coerceToUpdate: raw => raw, expandNumericDeltas, holdLevelBonusChanges: () => {},
        addLevelBonus: async () => null, applyGoalsFromReply: () => [],
        generateNewNpcProfiles: async () => ({ generated: 0, failed: 0 }),
        startExtractionReport: () => message, finishExtractionReport: (id, msg, report) => { msg.report = report; },
        extractionSwipe: () => 0, renderExtractionReport: () => {},
        document: { querySelector: () => null }, LOG_PREFIX: 'test',
    });
    return { run: (options = { regenerate: true }) => extraction.extractStateFromMessage(message.mes, 0, options),
        live: () => live, pending: () => pending, prompted: () => prompted, message, context, base,
        setResponse: value => { response = value; }, onRequest: fn => { onRequest = fn; } };
}
test('regeneration replaces XP and applied rows, clears old proposals and keeps manual edits', async () => {
    const h = harness();
    assert.equal((await h.run()).applied, true);
    assert.equal(h.prompted().player.stats.XP, '10');
    assert.equal(h.live().player.stats.XP, '30');
    assert.equal(h.live().player.stats.HP, '95');
    assert.deepEqual(h.pending(), []);
    assert.equal(h.message.extra.sillynpc_applied.length, 1);
    await h.run();
    assert.equal(h.live().player.stats.XP, '30');
    assert.equal(h.message.extra.sillynpc_applied.length, 1);
});
test('an unusable regeneration leaves the previous reading and pending proposals intact', async () => {
    const h = harness(); h.setResponse(null);
    assert.equal((await h.run()).applied, false);
    assert.equal(h.live().player.stats.XP, '30');
    assert.deepEqual(h.pending(), [{ old: true }]);
    assert.deepEqual(h.message.extra.sillynpc_applied, [{ old: true }]);
});
test('a new turn arriving during regeneration prevents replacing the older turn', async () => {
    const h = harness(); h.onRequest(() => h.context.chat.push({ mes: 'Next turn' }));
    assert.equal((await h.run()).applied, false);
    assert.equal(h.live().player.stats.XP, '30');
});
test('manual changes during the request survive replacement', async () => {
    const h = harness(); h.onRequest(() => { h.live().player.stats.HP = '80'; });
    await h.run();
    assert.equal(h.live().player.stats.HP, '80');
    assert.equal(h.live().player.stats.XP, '30');
});

test('manual mode skips automatic requests and replaces an explicitly requested reading', async () => {
    const h = harness('manual');
    let requests = 0;
    h.onRequest(() => { requests += 1; });
    assert.equal((await h.run({})).reason, 'extraction disabled');
    assert.equal(requests, 0);
    for (let i = 0; i < 2; i++) {
        assert.equal((await h.run({ manual: true, regenerate: true })).applied, true);
        assert.equal(h.live().player.stats.XP, '30');
        assert.equal(h.message.extra.sillynpc_applied.length, 1);
    }
    assert.equal(requests, 2);
});

test('manual reading is discarded if a new turn arrives during the request', async () => {
    const h = harness('manual');
    h.onRequest(() => h.context.chat.push({ mes: 'Next turn' }));
    assert.equal((await h.run({ manual: true })).reason, 'reply changed while reading');
    assert.equal(h.live().player.stats.XP, '30');
});

test('manual mode does not enable the reader in inline mode', async () => {
    const h = harness('inline');
    assert.equal((await h.run({ manual: true })).reason, 'extraction disabled');
});
