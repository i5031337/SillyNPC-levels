import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { selectLevelGrants, collectLevelTransitions } from '../src/tracker/extractor/status-level-grants.js';

const source = readFileSync(new URL('../src/tracker/extractor/status-level-reading.js', import.meta.url), 'utf8')
    .replace(/^import [\s\S]*?;\n/gm, '').replaceAll('export ', '');
function harness() {
    const message = { mes: 'Victory', swipe_id: 0, extra: {} };
    const context = { chat: [message], chatMetadata: {} };
    const tracker = { playerStats: [{ id: 'xp', name: 'XP', type: 'bar' },
        { id: 'level', name: 'Level', type: 'number' }, { id: 'hp', name: 'HP', type: 'bar' }],
        progression: { player: { enabled: true, xpFieldId: 'xp', levelFieldId: 'level', pointsPerLevel: 2, assignment: 'random', statIds: ['hp'] } },
        collections: [{ id: 'skills', targets: ['player'], fields: [{ id: 'name', name: 'name', type: 'text', isPrimary: true }],
            levelUpRewards: { enabled: true, mode: 'scheduled', schedule: [{ id: 'dodge', level: 2, entry: { name: 'Dodge' } }] } },
            { id: 'guided', targets: ['player'], fields: [{ id: 'name', name: 'name', type: 'text', isPrimary: true }],
                levelUpRewards: { enabled: true, mode: 'guided', interval: 1 } }] };
    const state = { player: { stats: { XP: '9/10', Level: '1', HP: '6/10' }, collections: {} } };
    const parsed = { player: { stats: { XP: '20/10' } } };
    let pending = [], applied = [], requestMode = 'partial';
    let duringRequest = () => {};
    const requested = [];
    const deps = {
        getContext: () => context, getSettings: () => ({ enabled: true, statusTracker: tracker }),
        getAllCharacters: () => [], getCurrentPersonaKey: () => 'persona',
        getPendingChanges: () => pending, setPendingChanges: (id, rows) => { pending = rows; },
        getLooseNotes: () => [], getRefusedValues: () => [], appliedChangesForCurrentSwipe: () => applied,
        saveChatSoon: () => {}, collectLevelTransitions,
        selectLevelGrants: (update, before, settings, text, leadUp, callContext) => selectLevelGrants(update, before, settings, text, leadUp,
            { ...callContext, requestExtraction: async prompt => {
                const tasks = JSON.parse(prompt).tasks; requested.push(tasks.map(task => task.id));
                await duringRequest();
                return { choices: (requestMode === 'partial' ? tasks.slice(0, 1) : tasks)
                    .map(task => ({ id: task.id, entry: { name: `Reward ${task.level}` } })) };
            } }),
    };
    const api = new Function(...Object.keys(deps), `${source}\nreturn {prepareLevelReading,saveLevelReading,retryLevelReading,LEVEL_READING_KEY};`)(...Object.values(deps));
    return { ...api, context, message, tracker, state, parsed, requested,
        pending: () => pending, setPending: rows => { pending = rows; }, setApplied: rows => { applied = rows; },
        setMode: mode => { requestMode = mode; }, duringRequest: fn => { duringRequest = fn; } };
}
async function initialReading(h) {
    const result = await h.prepareLevelReading(h.parsed, h.state, h.tracker, 'Victory', [], h.message, 0);
    h.saveLevelReading(h.message, result.reading); h.setPending(result.rows);
    return result;
}

test('retry requests missing choices only and keeps deterministic proposals without applying XP', async () => {
    const h = harness(), result = await initialReading(h);
    assert.equal(result.rows.length, 3);
    assert.equal(result.failures.length, 1);
    h.setMode('complete');
    const retry = await h.retryLevelReading(0);
    assert.equal(retry.applied, true);
    assert.equal(retry.pending, 1);
    assert.equal(h.requested[1].length, 1);
    assert.equal(h.pending().length, 4);
    assert.equal(h.pending().filter(row => row.kind === 'item-add').length, 3);
    assert.equal(h.state.player.stats.XP, '9/10');
    assert.equal(h.state.player.stats.Level, '1');
});

test('accepted and rejected grants stay decided when missing choices are retried', async () => {
    const h = harness(), result = await initialReading(h);
    const accepted = result.rows.find(row => row.kind === 'stat-points');
    const rejected = result.rows.find(row => row.kind === 'item-add');
    h.message.extra[h.LEVEL_READING_KEY].decidedGrantIds.push(accepted.grant.id, rejected.grant.id);
    h.setApplied([accepted]); h.setPending([]); h.setMode('complete');
    await h.retryLevelReading(0);
    assert.equal(h.pending().length, 2);
    assert.ok(h.pending().every(row => ![accepted.grant.id, rejected.grant.id].includes(row.grant.id)));
});

test('stale async reward reply leaves pending proposals and stored missing choices intact', async () => {
    const h = harness(); await initialReading(h);
    const before = structuredClone(h.message.extra[h.LEVEL_READING_KEY]);
    const pending = structuredClone(h.pending());
    h.setMode('complete'); h.duringRequest(() => { h.message.swipe_id = 1; });
    const retry = await h.retryLevelReading(0);
    assert.equal(retry.applied, false);
    assert.deepEqual(h.pending(), pending);
    assert.deepEqual(h.message.extra[h.LEVEL_READING_KEY], before);
    assert.equal(h.state.player.stats.XP, '9/10');
});

test('rejecting the XP transition prevents requests for its missing rewards', async () => {
    const h = harness(), result = await initialReading(h);
    h.message.extra[h.LEVEL_READING_KEY].rejectedTransitionIds = [result.transitions[0].transitionId];
    h.setPending([]);
    const retry = await h.retryLevelReading(0);
    assert.equal(retry.failures, 0);
    assert.equal(retry.pending, 0);
    assert.equal(h.requested.length, 1);
    assert.deepEqual(h.pending(), []);
});

test('retry preserves validated choices and requests only missing grants without altering XP', async () => {
    const tracker = { playerStats: [
        { id: 'xp', name: 'XP', type: 'bar' }, { id: 'level', name: 'Level', type: 'number' },
        { id: 'aim', name: 'Aim', type: 'number' }],
        progression: { player: { enabled: true, xpFieldId: 'xp', levelFieldId: 'level',
            pointsPerLevel: 2, assignment: 'random', statIds: ['aim'] } }, collections: [{ id: 'skills', targets: ['player'],
            fields: [{ id: 'name', name: 'name', type: 'text', isPrimary: true }],
            levelUpRewards: { enabled: true, mode: 'guided', interval: 1 } }] };
    const state = { player: { stats: { XP: '9/10', Level: '1', Aim: '2' } } };
    const parsed = { player: { stats: { XP: '20/10' } } };
    const first = await selectLevelGrants(parsed, state, tracker, 'Victory', [], {
        requestExtraction: async prompt => {
            const tasks = JSON.parse(prompt).tasks;
            return { choices: [{ id: tasks[0].id, entry: { name: 'Dodge' } }] };
        } });
    assert.equal(first.rows.length, 2);
    assert.equal(first.failures.length, 1);
    const retry = await selectLevelGrants(parsed, state, tracker, 'Victory', [], {
        cache: first.cache, random: () => assert.fail('Do not reroll point allocations'),
        requestExtraction: async prompt => {
            const tasks = JSON.parse(prompt).tasks;
            assert.equal(tasks.length, 1);
            return { choices: [{ id: tasks[0].id, entry: { name: 'Strike' } }] };
        } });
    assert.equal(retry.rows.length, 3);
    assert.equal(retry.failures.length, 0);
    assert.deepEqual(parsed, { player: { stats: { XP: '20/10' } } });
    assert.equal(state.player.stats.XP, '9/10');
});
