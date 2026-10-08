import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareGrantReview, selectReviewRows, materializeGrantRows, remainingGrantRows } from '../src/tracker/level-grant-review.js';
import { mergePendingMemoryRows } from '../src/memory/memory-review.js';

const settings = {
    playerStats: [{ id: 'xp', name: 'Experience', type: 'number', defaultValue: '0/100' }, { id: 'lv', name: 'Rank', type: 'number', defaultValue: '1' },
        { id: 'hp', name: 'Health', type: 'bar', defaultValue: '10/10' },
        { id: 'str', name: 'Strength', type: 'number', locked: true, maxStatValue: '10' }],
    progression: { player: { enabled: true, xpFieldId: 'xp', levelFieldId: 'lv', pointsPerLevel: 2, assignment: 'random', statIds: ['hp', 'str'] } },
};
const transition = { transitionId: 't', scope: 'player', actor: null, actorId: 'player:player', xpName: 'Experience', levelName: 'Rank', oldLevel: 1, newLevel: 2, xpAfter: '5/100' };
const grant = (id = 'g', label = 'Health') => ({ scope: 'player', actor: null, kind: 'stat', label, before: '6', after: '7', grant: { ...transition, id, gain: 1 } });
const state = { player: { stats: { Experience: '5/100', Rank: '2', Health: '6/10', Strength: '9' } }, characters: [] };

test('held XP holds its paired Level and grants require the entire dependency', () => {
    const xp = { scope: 'player', actor: null, kind: 'stat', label: 'Experience' };
    const level = { scope: 'player', actor: null, kind: 'stat', label: 'Rank' };
    const auto = [level], pending = [xp, grant()];
    prepareGrantReview(auto, pending, [transition]);
    assert.equal(auto.length, 0);
    assert.equal(selectReviewRows(pending, [grant()]).rows.length, 0);
    assert.equal(selectReviewRows(pending, [xp, level, grant()]).rows.length, 3);
});

test('growth uses live depletion and records both pool halves with full provenance', () => {
    const result = materializeGrantRows([grant()], state, settings, [], { acceptedTransitionIds: ['t'] });
    assert.deepEqual(result.rows.map(row => [row.kind, row.before, row.after]), [['stat', '6', '7'], ['stat-max', '10', '11']]);
    assert.equal(result.rows[0].grant.valueBefore, '6/10');
    assert.equal(result.rows[1].grant.valueAfter, '7/11');
    assert.equal(state.player.stats.Health, '6/10');
});

test('fixed ratings clamp; multiple crossed levels accumulate against current state', () => {
    const result = materializeGrantRows([grant('g1'), grant('g2'), grant('s', 'Strength')], state, settings, [], { acceptedTransitionIds: ['t'] });
    assert.equal(result.rows.find(row => row.grant.id === 'g2').grant.valueAfter, '8/12');
    assert.equal(result.rows.find(row => row.label === 'Strength').after, '10');
});

test('confirmed NPC rating rewards keep the proposed gains on slash-form bounded ratings', async () => {
    const { selectLevelGrants } = await import('../src/tracker/extractor/status-level-grants.js');
    const stats = settings.playerStats.map(def => ({ ...def }));
    const tracker = { ...settings, npcStats: stats, npcTemplates: [{ id: 'fighter',
        statIds: stats.map(def => def.id), progression: { ...settings.progression.player, pointsPerLevel: 6, assignment: 'manual' } }] };
    const cards = [{ id: 'mudkip', name: 'Mudkip', npcTemplateId: 'fighter' }];
    const initial = { player: { stats: {} }, characters: [{ name: 'Mudkip',
        npcTemplateId: 'fighter', stats: { Experience: '90/100', Rank: '1', Health: '6/10', Strength: '3/10' } }] };
    const selection = await selectLevelGrants({ characters: [{ name: 'Mudkip', Experience: '110/100' }] },
        initial, tracker, 'Victory', [], { cards, requestExtraction: () => assert.fail('No numeric model request') });
    assert.equal(selection.rows[0].grant.points, 6);
    selection.rows[0].allocations = { str: 3, hp: 3 };
    const leveled = structuredClone(initial);
    Object.assign(leveled.characters[0].stats, { Experience: '10/100', Rank: '2' });
    const accepted = materializeGrantRows(selection.rows, leveled, tracker, cards, {
        acceptedTransitionIds: selection.rows.map(row => row.grant.transitionId),
    });
    assert.deepEqual(accepted.rejected, []);
    const strength = accepted.rows.find(row => row.label === 'Strength');
    assert.ok(strength);
    assert.equal(strength.grant.valueAfter, '6/10');
    assert.equal(accepted.rows.some(row => row.label === 'Strength' && row.kind === 'stat-max'), false);
    assert.equal(accepted.rows.find(row => row.label === 'Health').grant.valueAfter, '9/13');
    assert.deepEqual(initial.characters[0].stats, {
        Experience: '90/100', Rank: '1', Health: '6/10', Strength: '3/10',
    });
});

test('stale transitions, changed actors and duplicate acceptance cannot grant again', () => {
    const options = { acceptedTransitionIds: ['t'] };
    const stale = structuredClone(state); stale.player.stats.Rank = '3';
    assert.equal(materializeGrantRows([grant()], stale, settings, [], options).rows.length, 0);
    const changed = grant(); changed.grant.actorId = 'player:other';
    assert.equal(materializeGrantRows([changed], state, settings, [], options).rows.length, 0);
    assert.equal(materializeGrantRows([grant()], state, settings, [], { ...options, appliedRows: [grant()] }).rows.length, 0);
    assert.equal(selectReviewRows([], [grant()]).rows.length, 0);
});

test('collection grants validate custom primary fields, targets and duplicates', () => {
    const tracker = { ...settings, collections: [{ id: 'skills', targets: ['player'], fields: [{ id: 'title', name: 'title', type: 'text', isPrimary: true }] }] };
    const row = { ...grant(), kind: 'item-add', collectionId: 'skills', item: { title: 'Dash' } };
    const options = { acceptedTransitionIds: ['t'] };
    assert.equal(materializeGrantRows([row], state, tracker, [], options).rows.length, 1);
    const held = structuredClone(state); held.player.collections = { skills: [{ title: 'dash' }] };
    assert.equal(materializeGrantRows([row], held, tracker, [], options).rows.length, 0);
    assert.equal(materializeGrantRows([{ ...row, item: {} }], state, tracker, [], options).rows.length, 0);
});

test('held transitions become invalid after another XP edit or a persona switch', async () => {
    const { validateReviewedTransitions } = await import('../src/tracker/level-grant-review.js');
    const provenance = { ...transition, xpBefore: '90/100' };
    const row = { scope: 'player', actor: null, kind: 'stat', label: 'Experience', transition: provenance };
    const before = structuredClone(state); before.player.stats.Experience = '90/100'; before.player.stats.Rank = '1';
    assert.equal(validateReviewedTransitions([row], before, settings).rows.length, 1);
    assert.equal(validateReviewedTransitions([row], state, settings).rows.length, 0);
    assert.equal(validateReviewedTransitions([row], before, settings, [], 'other-persona').rows.length, 0);
});

test('pool current and capacity rows compose without overwriting either half', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../src/tracker/status-diff-review.js', import.meta.url), 'utf8');
    const splitValue = value => { const [current, max = ''] = String(value ?? '').split('/'); return { current, max }; };
    const factory = new Function('splitValue', 'debugLog', 'primaryFieldName', 'itemKey',
        source.replace(/^import .*;\n/gm, '').replace(/export /g, '') + '\nreturn buildUpdateFromChanges;');
    const build = factory(splitValue, () => {}, () => 'name', item => item.name);
    const rows = materializeGrantRows([grant('g1'), grant('g2')], state, settings, [], { acceptedTransitionIds: ['t'] }).rows;
    assert.equal(build(rows, state, settings).player.stats.Health, '8/12');
});

test('review acceptance applies story and growth together, preserves partial grants and rejects retry dependencies', async () => {
    const { readFile } = await import('node:fs/promises');
    const { validateReviewedTransitions } = await import('../src/tracker/level-grant-review.js');
    const diffSource = await readFile(new URL('../src/tracker/status-diff-review.js', import.meta.url), 'utf8');
    const split = value => { const [current, max = ''] = String(value ?? '').split('/'); return { current, max }; };
    const build = new Function('splitValue', 'debugLog', 'primaryFieldName', 'itemKey',
        diffSource.replace(/^import .*;\n/gm, '').replace(/export /g, '') + '\nreturn buildUpdateFromChanges;')
        (split, () => {}, () => 'name', item => item.name);
    let live = structuredClone(state), writes = 0;
    const message = { extra: { sillynpc_pending: [grant('g1'), grant('g2')],
        sillynpc_applied: [{ transition }], sillynpc_level_reading: {} } };
    const source = await readFile(new URL('../src/tracker/status-review.js', import.meta.url), 'utf8');
    const outcomes = await readFile(new URL('../src/tracker/review-stat-outcomes.js', import.meta.url), 'utf8');
    const failedReviewedStats = new Function('splitValue', outcomes.replace(/^import .*;\n/gm, '').replace(/export /g, '')
        + '\nreturn failedReviewedStats;')(split);
    const dependencies = {
        getContext: () => ({ chat: [message] }), getSettings: () => ({ statusTracker: settings }),
        getAllCharacters: () => [], debugLog: () => {}, eventSource: { emit() {} },
        loadStateFromMetadata: () => live, saveStateToMetadata: () => {}, getCurrentPersonaKey: () => 'player',
        applyUpdate: (update, options) => {
            const result = structuredClone(live);
            Object.assign(result.player.stats, update.player?.stats);
            if (!options.dryRun) { live = result; writes++; }
            return result;
        }, buildUpdateFromChanges: build, recordAppliedChanges: (_id, rows) => message.extra.sillynpc_applied.push(...rows),
        saveChatSoon: () => {}, appliedChangesForCurrentSwipe: () => message.extra.sillynpc_applied,
        selectReviewRows, materializeGrantRows, validateReviewedTransitions, remainingGrantRows,
        activeNpcSystem: () => null, mergePendingMemoryRows, failedReviewedStats,
    };
    const resolve = new Function(...Object.keys(dependencies), source.replace(/^import .*;\n/gm, '').replace(/export /g, '')
        + '\nreturn resolvePendingChanges;')(...Object.values(dependencies));
    resolve(0, [grant('g1')]);
    assert.equal(writes, 1);
    assert.equal(live.player.stats.Health, '7/11');
    assert.equal(message.extra.sillynpc_pending.length, 1);
    assert.deepEqual(message.extra.sillynpc_level_reading.decidedGrantIds, ['g1']);
    resolve(0, [grant('g2')]);
    assert.equal(live.player.stats.Health, '8/12');
    assert.equal(writes, 2);
    resolve(0, [grant('g2')]);
    assert.equal(writes, 2);

    live = structuredClone(state); live.player.stats.Rank = '1'; live.player.stats.Experience = '90/100';
    const held = { ...transition, xpBefore: '90/100' };
    const xp = { scope: 'player', actor: null, kind: 'stat', label: 'Experience', before: '90', after: '5', transition: held };
    const level = { scope: 'player', actor: null, kind: 'stat', label: 'Rank', before: '1', after: '2', transition: held };
    message.extra.sillynpc_pending = [xp, level, grant('g3')];
    message.extra.sillynpc_applied = [];
    resolve(0, [xp, level, grant('g3')]);
    assert.equal(writes, 3);
    assert.equal(live.player.stats.Rank, '2');
    assert.equal(live.player.stats.Health, '7/11');
    message.extra.sillynpc_pending = [xp, level];
    resolve(0, []);
    assert.deepEqual(message.extra.sillynpc_level_reading.rejectedTransitionIds, ['t']);

    live = structuredClone(state);
    const budget = { ...grant('budget'), kind: 'stat-points', label: 'Skill points', allocations: {},
        grant: { ...grant('budget').grant, points: 5, assignment: 'manual', statIds: ['hp', 'str'], spent: 0 } };
    message.extra.sillynpc_pending = [budget];
    message.extra.sillynpc_applied = [{ transition }];
    message.extra.sillynpc_level_reading = {};
    resolve(0, [{ ...budget, allocations: { hp: 2 } }]);
    assert.equal(live.player.stats.Health, '8/12');
    assert.equal(message.extra.sillynpc_pending[0].grant.points, 3);
    assert.equal(message.extra.sillynpc_pending[0].grant.spent, 2);
    assert.deepEqual(message.extra.sillynpc_level_reading.decidedGrantIds, []);
    const partialWrites = writes;
    resolve(0, [{ ...budget, allocations: { hp: 2 } }]);
    assert.equal(writes, partialWrites, 'A stale confirmation cannot spend the budget again');
    // The remaining budget survives serialization and later level-ups.
    message.extra.sillynpc_pending = JSON.parse(JSON.stringify(message.extra.sillynpc_pending));
    live.player.stats.Rank = '3';
    const remainder = message.extra.sillynpc_pending[0];
    resolve(0, [{ ...remainder, allocations: { hp: 3 } }]);
    assert.equal(live.player.stats.Health, '11/15');
    assert.equal(message.extra.sillynpc_pending, undefined);
    assert.deepEqual(message.extra.sillynpc_level_reading.decidedGrantIds, ['budget']);
    assert.equal(new Set(message.extra.sillynpc_applied.filter(row => row.kind === 'stat').map(row => row.grant.id)).size, 2);
    resolve(0, [{ ...remainder, allocations: { hp: 3 } }]);
    assert.equal(live.player.stats.Health, '11/15');

    const capped = { ...budget, grant: { ...budget.grant, assignment: 'random' }, allocations: { str: 5 } };
    live.player.stats.Strength = '10';
    message.extra.sillynpc_pending = [capped];
    message.extra.sillynpc_applied = [{ transition }];
    message.extra.sillynpc_level_reading = {};
    resolve(0, [capped]);
    assert.equal(message.extra.sillynpc_pending[0].grant.points, 5);
    assert.deepEqual(message.extra.sillynpc_pending[0].allocations, {});
    assert.equal(live.player.stats.Strength, '10');
});
