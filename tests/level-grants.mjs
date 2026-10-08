import assert from 'node:assert/strict';
import test from 'node:test';
import { collectLevelTransitions, selectLevelGrants } from '../src/tracker/extractor/status-level-grants.js';
import { materializeGrantRows } from '../src/tracker/level-grant-review.js';

const stats = [
    { id: 'xp', name: 'Experience', type: 'bar', defaultValue: '0/10' },
    { id: 'level', name: 'Rank', type: 'number', defaultValue: '1' },
    { id: 'hp', name: 'Vitality', type: 'bar', defaultValue: '10/10' },
    { id: 'power', name: 'Power', type: 'number', defaultValue: '1', maxStatValue: 5, locked: true },
    { id: 'text', name: 'Mood', type: 'text', defaultValue: 'Calm' },
];
const config = { enabled: true, xpFieldId: 'xp', levelFieldId: 'level', pointsPerLevel: 4,
    assignment: 'random', statIds: ['hp', 'power'] };
const sheet = { Experience: '8/10', Rank: '1', Vitality: '6/10', Power: '4/5' };
const tracker = () => ({ playerStats: structuredClone(stats), npcStats: structuredClone(stats),
    progression: { player: structuredClone(config) },
    npcTemplates: [{ id: 'fighter', statIds: stats.map(item => item.id), progression: structuredClone(config) },
        { id: 'bystander', statIds: stats.map(item => item.id), progression: { ...config, enabled: false } }], collections: [] });
const state = () => ({ player: { stats: { ...sheet }, collections: {} }, characters: [
    { id: 'npc-one', name: 'Ada', npcTemplateId: 'fighter', stats: { ...sheet } },
    { id: 'npc-two', name: 'Bea', npcTemplateId: 'bystander', stats: { ...sheet } },
] });
const parsed = () => ({ player: { stats: { Experience: '25/10', Vitality: '2' } },
    characters: [{ name: 'Ada', Experience: '10/10' }, { name: 'Bea', stats: { Experience: '20/10' } },
        { name: 'New NPC', npcTemplateId: 'fighter', stats: { Experience: '100/10', Rank: '5' } }] });
const noModel = () => assert.fail('Numeric growth must not call the model');
const collection = mode => ({ id: 'skills', name: 'Skills', targets: ['player', 'npc', 'template:fighter'],
    fields: [{ id: 'identifier', name: 'Technique', isPrimary: true, type: 'text' },
        { id: 'power', name: 'Power', type: 'number', min: 1, maxStatValue: 5 }],
    levelUpRewards: { enabled: true, mode, interval: 1,
        schedule: [{ id: 'skill-two', level: 2, entry: { identifier: 'Dodge', power: 2 } },
            { id: 'skill-three', level: 3, entry: { identifier: 'Strike', power: 3 } }] } });

test('renamed fields and flat NPC XP transition only existing opted-in actors', () => {
    const update = parsed(), before = structuredClone(update);
    const transitions = collectLevelTransitions(update, state(), tracker(), { messageId: 7, swipeId: 2 });
    assert.deepEqual(transitions.map(item => [item.actor, item.oldLevel, item.newLevel, item.xpAfter]),
        [[null, 1, 3, '5/10'], ['Ada', 1, 2, '0/10']]);
    assert.equal(transitions[1].actorId, 'npc:npc-one');
    assert.deepEqual(update, before);
});

test('random allocation is code-owned, with replacement, across every gained level', async () => {
    const update = parsed(), initial = state(), before = structuredClone({ update, initial });
    const result = await selectLevelGrants(update, initial, tracker(), 'Victory', [], { random: () => 0, requestExtraction: noModel });
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.rows.map(row => [row.actor, row.grant.points, row.allocations]),
        [[null, 8, { hp: 8 }], ['Ada', 4, { hp: 4 }]]);
    assert.deepEqual({ update, initial }, before);
    const leveled = structuredClone(initial); leveled.player.stats.Rank = '3'; leveled.characters[0].stats.Rank = '2';
    // Story depletion is applied first; growth preserves it.
    leveled.player.stats.Vitality = '2/10';
    const applied = materializeGrantRows(result.rows, leveled, tracker(), [], {
        acceptedTransitionIds: result.rows.map(row => row.grant.transitionId),
    });
    assert.deepEqual(applied.rejected, []);
    assert.equal(applied.rows.find(row => row.scope === 'player').grant.valueAfter, '10/18');
    assert.equal(applied.rows.find(row => row.scope === 'character').grant.valueAfter, '10/14');
    assert.deepEqual(applied.remaining, []);
});

test('random picks exclude capped ratings and remove stats as soon as they reach their cap', async () => {
    const result = await selectLevelGrants(parsed(), state(), tracker(), 'Victory', [], { random: () => .99, requestExtraction: noModel });
    assert.deepEqual(result.rows.map(row => row.allocations), [{ power: 1, hp: 7 }, { power: 1, hp: 3 }]);
    const initial = state(); initial.player.stats.Power = '5/5';
    const capped = await selectLevelGrants({ player: { Experience: '10/10' } }, initial, tracker(), '', [], {
        random: () => .99, requestExtraction: noModel,
    });
    assert.deepEqual(capped.rows[0].allocations, { hp: 4 });
});

test('all capped stats retain their unspent budget without choosing an invalid stat', async () => {
    const settings = tracker(), initial = state();
    settings.progression.player.statIds = ['power']; initial.player.stats.Power = '5/5';
    const result = await selectLevelGrants({ player: { Experience: '10/10' } }, initial, settings, '', [], { requestExtraction: noModel });
    assert.equal(result.rows[0].grant.points, 4);
    assert.deepEqual(result.rows[0].allocations, {});
    initial.player.stats.Rank = '2';
    const accepted = materializeGrantRows(result.rows, initial, settings, [], {
        acceptedTransitionIds: [result.rows[0].grant.transitionId],
    });
    assert.deepEqual(accepted.rows, []);
    assert.equal(accepted.remaining[0].grant.points, 4);
});

test('manual allocation creates an untouched budget and supports partial spending at later levels', async () => {
    const settings = tracker(); settings.progression.player.assignment = 'manual';
    const initial = state();
    const result = await selectLevelGrants({ player: { Experience: '10/10' } }, initial, settings, '', [], { requestExtraction: noModel });
    const budget = result.rows[0];
    assert.deepEqual(budget.allocations, {});
    initial.player.stats.Rank = '3';
    const accepted = materializeGrantRows([{ ...budget, allocations: { power: 1, hp: 1 } }], initial, settings, [], {
        acceptedTransitionIds: [budget.grant.transitionId],
    });
    assert.equal(accepted.rows.find(row => row.label === 'Power').grant.valueAfter, '5/5');
    assert.equal(accepted.rows.find(row => row.label === 'Vitality').grant.valueAfter, '7/11');
    assert.equal(accepted.remaining[0].grant.points, 2);
    assert.equal(accepted.remaining[0].grant.spent, 2);
    assert.deepEqual(accepted.remaining[0].allocations, {});
});

test('random allocations survive reloads and retries without rerolling or spending twice', async () => {
    const result = await selectLevelGrants(parsed(), state(), tracker(), '', [], { random: () => 0, requestExtraction: noModel });
    const retry = await selectLevelGrants(parsed(), state(), tracker(), '', [], {
        cache: JSON.parse(JSON.stringify(result.cache)), random: () => assert.fail('Do not reroll'), requestExtraction: noModel,
    });
    assert.deepEqual(retry, result);
    const changed = tracker(); changed.progression.player.pointsPerLevel = 30;
    changed.progression.player.assignment = 'manual';
    const stable = await selectLevelGrants(parsed(), state(), changed, '', [], {
        cache: result.cache, allowNewPointBudgets: false, random: () => assert.fail('Do not reroll'), requestExtraction: noModel,
    });
    assert.deepEqual(stable, result, 'Changing settings must not alter an already earned budget');
    const decided = await selectLevelGrants(parsed(), state(), tracker(), '', [], {
        cache: result.cache, decidedGrantIds: result.rows.map(row => row.grant.id), requestExtraction: noModel,
    });
    assert.deepEqual(decided.rows, []);
});

test('retrying saved collection rewards never backfills new numeric budgets', async () => {
    const result = await selectLevelGrants(parsed(), state(), tracker(), '', [], {
        allowNewPointBudgets: false, requestExtraction: noModel,
    });
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.cache, {});
});

test('zero-point progression advances without numeric growth or model calls', async () => {
    const settings = tracker(); settings.progression.player.pointsPerLevel = 0;
    settings.npcTemplates[0].progression.pointsPerLevel = 0;
    const result = await selectLevelGrants(parsed(), state(), settings, '', [], { requestExtraction: noModel });
    assert.deepEqual(result.rows, []);
    assert.equal(collectLevelTransitions(parsed(), state(), settings).length, 2);
});

test('scheduled rewards retain targeting and skip owned and story-proposed identifiers', async () => {
    const settings = tracker(); settings.collections = [collection('scheduled')];
    const initial = state(); initial.player.collections.skills = [{ Technique: 'DODGE', Power: 2 }];
    const update = parsed(); update.player.collections = { skills: { add: [{ Technique: 'Strike', Power: 3 }] } };
    const result = await selectLevelGrants(update, initial, settings, '', [], { requestExtraction: noModel });
    assert.equal(result.rows.filter(row => row.kind === 'stat-points').length, 2);
    const rewards = result.rows.filter(row => row.kind === 'item-add');
    assert.equal(rewards.length, 1); assert.equal(rewards[0].actor, 'Ada'); assert.equal(rewards[0].item.Technique, 'Dodge');
});

test('only guided collections use the model; retries preserve point allocations and request missing rewards only', async () => {
    const settings = tracker(); settings.collections = [collection('guided')];
    const requests = [];
    const first = await selectLevelGrants(parsed(), state(), settings, '', [], {
        random: () => 0,
        requestExtraction: async (prompt, schema) => {
            const tasks = JSON.parse(prompt).tasks; requests.push(tasks);
            assert.equal(tasks.length, 3);
            assert.ok(tasks.every(task => task.type === 'collection' && !task.eligibleStats));
            assert.equal(prompt.includes('npc-one'), false);
            assert.equal(schema.properties.choices.properties['task-1'].properties.amount, undefined);
            return { choices: { [tasks[0].id]: { entry: { Technique: 'Dodge', Power: 2 } },
                [tasks[1].id]: { entry: { Technique: 'Bad', Power: 99 } }, [tasks[2].id]: { noReward: true } } };
        },
    });
    assert.equal(first.failures.length, 1);
    const retry = await selectLevelGrants(parsed(), state(), settings, '', [], {
        cache: first.cache, random: () => assert.fail('Numeric growth must remain cached'),
        requestExtraction: async prompt => {
            const tasks = JSON.parse(prompt).tasks; requests.push(tasks);
            assert.equal(tasks.length, 1); assert.equal(tasks[0].id, 'task-1'); assert.equal(tasks[0].level, 3);
            return { choices: { 'task-1': { entry: { Technique: 'Strike', Power: 3 } } } };
        },
    });
    assert.deepEqual(retry.failures, []);
    assert.deepEqual(retry.rows.filter(row => row.kind === 'stat-points'), first.rows.filter(row => row.kind === 'stat-points'));
    assert.equal(requests.length, 2);
});

test('flat collection choices are validated, cached, and deduplicated like wrapped entries', async () => {
    const settings = tracker();
    settings.collections = [{ id: 'moves', name: 'Moves', targets: ['template:fighter'],
        fields: [{ id: 'name', name: 'Name', type: 'text', isPrimary: true },
            { id: 'type', name: 'Type', type: 'text', options: ['Normal', 'Water'] }],
        levelUpRewards: { enabled: true, mode: 'guided', interval: 1 } }];
    const response = { choices: { 'task-1': { name: 'Growl', type: 'Normal',
        description: "The Pokémon emits a menacing growl, lowering the target's Attack stat." } } };
    const run = (reply, extra = {}) => selectLevelGrants(parsed(), state(), settings, '', [], {
        requestExtraction: async () => reply, ...extra,
    });
    const result = await run(response);
    assert.deepEqual(result.failures, []);
    const reward = result.rows.find(row => row.kind === 'item-add');
    assert.deepEqual(reward.item, { Name: 'Growl', Type: 'Normal' });
    assert.equal(reward.actor, 'Ada');
    const cached = await run(null, { cache: JSON.parse(JSON.stringify(result.cache)), requestExtraction: noModel });
    assert.deepEqual(cached.rows.find(row => row.kind === 'item-add'), reward);
    for (const choice of [{ type: 'Normal' }, { name: 'Growl', type: 'Invalid' },
        { name: 'Growl', type: 4 }, { name: 'Growl', type: 'Normal', entry: {} }]) {
        const invalid = await run({ choices: { 'task-1': choice } });
        assert.equal(invalid.failures.length, 1);
        assert.equal(invalid.rows.some(row => row.kind === 'item-add'), false);
    }
    const initial = state(); initial.characters[0].collections = { moves: [{ Name: 'Growl', Type: 'Normal' }] };
    const duplicate = await selectLevelGrants(parsed(), initial, settings, '', [], { requestExtraction: async () => response });
    assert.deepEqual(duplicate.failures, []);
    assert.equal(duplicate.rows.some(row => row.kind === 'item-add'), false);
    const declined = await run({ choices: { 'task-1': { noReward: true } } });
    assert.deepEqual(declined.failures, []);
    assert.equal(declined.rows.some(row => row.kind === 'item-add'), false);
    settings.collections[0].fields[0] = { id: 'move-id', name: 'id', type: 'text', isPrimary: true };
    const identifier = await run({ choices: { 'task-1': { id: 'Growl', Type: 'Normal' } } });
    assert.deepEqual(identifier.rows.find(row => row.kind === 'item-add').item, { id: 'Growl', Type: 'Normal' });
    const missingIdentifier = await run({ choices: { 'task-1': { Type: 'Normal' } } });
    assert.equal(missingIdentifier.failures.length, 1, 'Task keys cannot substitute for a configured identifier');
});

test('model failure preserves numeric budgets and scheduled rewards', async () => {
    const settings = tracker(); settings.collections = [collection('guided'), { ...collection('scheduled'), id: 'scheduled' }];
    const result = await selectLevelGrants(parsed(), state(), settings, '', [], {
        requestExtraction: async () => { throw new Error('offline'); },
    });
    assert.equal(result.failures.length, 3);
    assert.equal(result.rows.filter(row => row.kind === 'stat-points').length, 2);
    assert.equal(result.rows.filter(row => row.kind === 'item-add').length, 3);
});

test('offstage cards and aliases resolve progression without admitting them to the scene', async () => {
    const initial = state(); initial.characters = [];
    const cards = [{ id: 'offstage', name: 'Ada', aliases: [{ pattern: 'A', isRegex: false }],
        npcTemplateId: 'fighter', statusOverrides: { ...sheet } }];
    const result = await selectLevelGrants({ characters: [{ name: 'A', Experience: '10/10' }] }, initial, tracker(), '', [], {
        cards, requestExtraction: noModel,
    });
    assert.equal(result.rows.length, 1); assert.equal(result.rows[0].actor, 'Ada');
    assert.equal(result.rows[0].grant.actorId, 'npc:offstage');
    assert.deepEqual(initial.characters, []); assert.equal(cards[0].statusOverrides.Rank, '1');
});
