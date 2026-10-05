import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/tracker/extractor/status-inline-grants.js', import.meta.url), 'utf8')
    .replace(/^import [\s\S]*?;\n/gm, '').replaceAll('export ', '');
function harness() {
    const message = { mes: 'A victory', swipe_id: 0 };
    const context = { chat: [message], chatMetadata: {} };
    const state = { player: { stats: { XP: '9/10', Level: '1' } } };
    const calls = { applied: [], pending: [], selections: 0, records: [], replacements: 0, resets: 0 };
    let duringSelection = () => {};
    const deps = {
        getContext: () => context, getSettings: () => ({ statusTracker: { extractionMode: calls.mode || 'inline' } }),
        getAllCharacters: () => [], loadStateFromMetadata: () => state, getCurrentPersonaKey: () => 'persona',
        parseMessageForUpdates: text => ({ cleanedText: text }),
        sanitizeModelUpdate: update => update, expandNumericDeltas: update => update,
        normalizeCollectionUpdates: () => [], rememberSwipeBase: () => {}, refreshTurnBase: () => {},
        trackerMessageIndex: chat => chat.length - 1,
        applyUpdate: (update, options) => { if (!options.dryRun) calls.applied.push({ update, options }); return state; },
        computeStateDiff: () => [{ scope: 'player', label: 'XP', kind: 'stat', after: '0' }],
        partitionChanges: changes => ({ auto: changes, pending: [] }),
        buildUpdateFromChanges: rows => ({ rows }), attachReasons: () => [], isItemDecided: () => false,
        setPendingChanges: (id, rows) => { calls.pending = rows; },
        recordAppliedChanges: (id, rows) => { calls.records = rows; }, collectLeadUp: () => [],
        prepareGrantReview: () => {}, validateReviewedTransitions: () => ({ invalid: new Set() }), renderStatusTrackerBox: () => {},
        prepareLevelReading: async () => {
            calls.selections++; await duringSelection();
            return { rows: [{ kind: 'stat', label: 'HP', grant: { id: 'reward' } }], transitions: [], failures: [], reading: { personaId: 'persona' } };
        },
        saveLevelReading: (msg, reading) => { msg.reading = reading; },
        replacementReadingState: () => { calls.replacements++; return structuredClone(state); },
        revertToBase: () => { calls.resets++; return { reverted: true }; },
        finishExtractionReport: (id, msg, report) => { msg.report = report; },
    };
    const queue = new Function(...Object.keys(deps), `${source}\nreturn queueInlineReading;`)(...Object.values(deps));
    const element = { classList: { contains: () => false } };
    return { queue: (id = 0, fingerprint = 'block') => queue({ player: { stats: { XP: '10/10' } } }, id, element, fingerprint),
        context, calls, message, setDuringSelection: fn => { duringSelection = fn; } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('inline archive rendering cannot apply XP or start grant selection', async () => {
    const h = harness(); h.context.chat.push({ mes: 'A newer turn' });
    assert.equal(h.queue(), false);
    await settle();
    assert.equal(h.calls.selections, 0);
    assert.equal(h.calls.applied.length, 0);
});

test('inline reading records automatic transition and keeps grants pending; rendering it again cannot award twice', async () => {
    const h = harness();
    assert.equal(h.queue(), true);
    assert.equal(h.queue(), false);
    await settle();
    assert.equal(h.calls.selections, 1);
    assert.equal(h.calls.applied.length, 1);
    assert.equal(h.calls.applied[0].options.progressionResolved, true);
    assert.equal(h.calls.pending[0].grant.id, 'reward');
    assert.equal(h.calls.records[0].label, 'XP');
    assert.equal(h.message.reading.sourceText, h.message.mes);
    assert.equal(h.message.report.status, 'done');
    assert.equal(h.message.report.summary, '1 applied · 1 awaiting review');
    assert.deepEqual(h.message.report.output, { player: { stats: { XP: '10/10' } } });
    assert.equal(h.queue(), false);
});

test('swiping during asynchronous reward selection leaves tracker state untouched', async () => {
    const h = harness(); h.setDuringSelection(() => { h.message.swipe_id = 1; });
    assert.equal(h.queue(), true);
    await settle();
    assert.equal(h.calls.selections, 1);
    assert.equal(h.calls.applied.length, 0);
    assert.deepEqual(h.calls.pending, []);
    assert.equal(h.message.reading, undefined);
});

test('changed inline reading replaces its previous turn before applying rather than stacking XP', async () => {
    const h = harness(); h.queue(); await settle();
    assert.equal(h.queue(0, 'changed block'), true);
    await settle();
    assert.equal(h.calls.selections, 2);
    assert.equal(h.calls.resets, 1);
    assert.equal(h.calls.replacements, 2);
    assert.equal(h.queue(0, 'changed block'), false);
});

test('separate reader mode never also awards an inline block', async () => {
    const h = harness(); h.calls.mode = 'extract';
    assert.equal(h.queue(), false);
    await settle();
    assert.equal(h.calls.applied.length, 0);
    assert.equal(h.calls.selections, 0);
});
