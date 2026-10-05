import assert from 'node:assert/strict';
import test from 'node:test';
import { collectLevelTransitions, selectLevelGrants } from '../src/tracker/extractor/status-level-grants.js';
import { boostStat } from '../src/tracker/progression.js';

const stats = [
    { id: 'xp', name: 'Experience', type: 'bar', defaultValue: '0/10' },
    { id: 'level', name: 'Rank', type: 'number', defaultValue: '1' },
    { id: 'hp', name: 'Vitality', type: 'bar', defaultValue: '10/10', updatePolicy: 'turn' },
    { id: 'power', name: 'Power', type: 'number', defaultValue: '1', maxStatValue: 5, updatePolicy: 'advancement' },
    { id: 'locked', name: 'Locked', type: 'number', locked: true },
];
const config = { enabled: true, xpFieldId: 'xp', levelFieldId: 'level', statGrowth: 'all',
    statIds: ['hp', 'power', 'locked'], increments: { hp: 2, power: 1 } };
const sheet = { Experience: '8/10', Rank: '1', Vitality: '6/10', Power: '4', Locked: '2' };
const tracker = () => ({ playerStats: structuredClone(stats), npcStats: structuredClone(stats),
    progression: { player: structuredClone(config) },
    npcTemplates: [{ id: 'fighter', statIds: stats.map(item => item.id), progression: structuredClone(config) },
        { id: 'bystander', statIds: stats.map(item => item.id), progression: { ...config, enabled: false } }], collections: [] });
const state = () => ({ player: { stats: { ...sheet }, collections: {} }, characters: [
    { id: 'npc-one', name: 'Ada', npcTemplateId: 'fighter', stats: { ...sheet } },
    { id: 'npc-two', name: 'Bea', npcTemplateId: 'bystander', stats: { ...sheet } },
] });
const parsed = () => ({ player: { stats: { Experience: '25/10', Vitality: '2' } },
    characters: [{ name: 'Ada', stats: { Experience: '10/10' } }, { name: 'Bea', stats: { Experience: '20/10' } },
        { name: 'New NPC', npcTemplateId: 'fighter', stats: { Experience: '100/10', Rank: '5' } }] });
const collection = mode => ({ id: 'skills', name: 'Skills', targets: ['player', 'npc', 'template:fighter'],
    fields: [{ id: 'identifier', name: 'Technique', isPrimary: true, type: 'text' },
        { id: 'power', name: 'Power', type: 'number', min: 1, maxStatValue: 5 }],
    levelUpRewards: { enabled: true, mode, interval: 1,
        schedule: [{ id: 'skill-two', level: 2, entry: { identifier: 'Dodge', power: 2 } },
            { id: 'skill-three', level: 3, entry: { identifier: 'Strike', power: 3 } }] } });

test('renamed configured fields transition only existing opted-in actors without mutating input', () => {
    const update = parsed(), before = structuredClone(update);
    const transitions = collectLevelTransitions(update, state(), tracker(), { messageId: 7, swipeId: 2 });
    assert.deepEqual(transitions.map(item => [item.actor, item.oldLevel, item.newLevel, item.xpAfter]),
        [[null, 1, 3, '5/10'], ['Ada', 1, 2, '0/10']]);
    assert.equal(transitions[1].actorId, 'npc:npc-one');
    assert.deepEqual(update, before);
});

test('all growth stays separate from simultaneous story changes and retains exact per-level gain', async () => {
    const update = parsed(), initial = state();
    const before = structuredClone({ update, initial });
    const { rows, failures } = await selectLevelGrants(update, initial, tracker(), 'A hard fought victory');
    assert.equal(rows.length, 6);
    assert.deepEqual(failures, []);
    const hp = rows.find(row => row.scope === 'player' && row.label === 'Vitality');
    assert.equal(hp.before, '6');
    assert.equal(hp.after, '8');
    assert.equal(hp.grant.gain, 2);
    assert.deepEqual(hp.grant.bounds, { growMaximum: true, fixedMaximum: null });
    assert.deepEqual({ update, initial }, before);
    assert.equal(rows.some(row => row.label === 'Locked'), false);
    assert.equal(new Set(rows.map(row => row.grant.id)).size, rows.length);
});

test('scheduled grants honor all overlapping targets once and skip owned or story-proposed identifiers', async () => {
    const settings = tracker(); settings.collections = [collection('scheduled')];
    settings.progression.player.statGrowth = 'none';
    settings.npcTemplates[0].progression.statGrowth = 'none';
    const initial = state(); initial.player.collections.skills = [{ Technique: 'DODGE', Power: 2 }];
    const update = parsed(); update.player.collections = { skills: { add: [{ Technique: 'Strike', Power: 3 }] } };
    const { rows } = await selectLevelGrants(update, initial, settings, 'Victory');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor, 'Ada');
    assert.equal(rows[0].item.Technique, 'Dodge');
});

test('one stat and guided selections are batched; malformed choices preserve deterministic rows and retry missing only', async () => {
    const settings = tracker(); settings.collections = [collection('guided')];
    settings.progression.player.statGrowth = 'one';
    const requests = [];
    const requestExtraction = async prompt => {
        const tasks = JSON.parse(prompt).tasks; requests.push(tasks);
        return { choices: tasks.map(task => ({ id: task.id, ...(task.type === 'stat'
            ? { statId: 'hp', amount: 2 }
            : task.recipient === 'Ada' ? { entry: null } : { entry: { Technique: `Skill ${task.level}`, Power: 99 } }) })) };
    };
    const result = await selectLevelGrants(parsed(), state(), settings, 'Victory', [], { requestExtraction });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].length, 5);
    assert.equal(result.failures.length, 2);
    assert.equal(result.rows.length, 4);
    const retry = await selectLevelGrants(parsed(), state(), settings, 'Victory', [], { cache: result.cache,
        requestExtraction: async prompt => {
            const tasks = JSON.parse(prompt).tasks; requests.push(tasks);
            return { choices: tasks.map(task => ({ id: task.id, entry: { Technique: `Skill ${task.level}`, Power: 2 } })) };
        } });
    assert.equal(requests[1].length, 2);
    assert.equal(retry.failures.length, 0);
    assert.equal(retry.rows.length, 6);
});

test('guided no-reward is cached and duplicate proposals cannot overwrite or increase holdings', async () => {
    const settings = tracker(); settings.collections = [collection('guided')];
    settings.progression.player.statGrowth = 'none'; settings.npcTemplates[0].progression.statGrowth = 'none';
    const result = await selectLevelGrants(parsed(), state(), settings, 'Victory', [], {
        requestExtraction: async prompt => ({ choices: JSON.parse(prompt).tasks.map(task => ({ id: task.id,
            entry: task.recipient === 'Ada' ? null : { Technique: 'Same skill', Power: 2 } })) }) });
    assert.equal(result.rows.length, 1);
    assert.equal(result.failures.length, 0);
    assert.equal(Object.keys(result.cache).length, 3);
    const retry = await selectLevelGrants(parsed(), state(), settings, 'Victory', [], {
        cache: result.cache, requestExtraction: () => assert.fail('Valid choices must not request again') });
    assert.equal(retry.rows.length, 1);
});

test('explicit Turn pool bound clamps capacity growth without jumping to the fixed bound', () => {
    assert.equal(boostStat('6/10', undefined, 1, { growMaximum: true, fixedMaximum: 20 }), '7/11');
    assert.equal(boostStat('6/10', undefined, 2, { growMaximum: true, fixedMaximum: 11 }), '7/11');
    assert.equal(boostStat('6/10', undefined, 2, { growMaximum: true, fixedMaximum: 10 }), '6/10');
});

test('offstage existing cards can earn rewards without creating scene presence', () => {
    const initial = state(); initial.characters = [];
    const cards = [{ id: 'offstage', name: 'Ada', npcTemplateId: 'fighter', statusOverrides: { ...sheet } }];
    const transitions = collectLevelTransitions({ characters: [{ name: 'Ada', stats: { Experience: '10/10' } }] },
        initial, tracker(), { cards });
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].actorId, 'npc:offstage');
    assert.deepEqual(initial.characters, []);
});

test('failed model selection preserves scheduled and all-stat proposals and reports each missing task', async () => {
    const settings = tracker(); settings.collections = [collection('scheduled'), { ...collection('guided'), id: 'abilities' }];
    const result = await selectLevelGrants(parsed(), state(), settings, 'Victory', [], {
        requestExtraction: async () => { throw new Error('Reader unavailable'); } });
    assert.equal(result.rows.length, 9);
    assert.equal(result.failures.length, 3);
    assert.ok(result.failures.every(failure => failure.message === 'Reader unavailable'));
});

test('offstage aliases resolve canonical ownership once, including regex names and invalid regex definitions', async () => {
    const initial = state(); initial.characters = [];
    const settings = tracker(); settings.collections = [collection('scheduled')];
    const cards = [{ id: 'ada', name: 'Ada', npcTemplateId: 'fighter', statusOverrides: { ...sheet },
        aliases: [{ pattern: 'Warrior' }, { pattern: '[', isRegex: true }, { pattern: '^Lady Ada', isRegex: true }] }];
    const update = { characters: [{ name: 'Warrior', offstage: true, stats: { Experience: '10/10' } },
        { name: 'Lady Ada the Brave', offstage: true, stats: { Experience: '10/10' } }] };
    const transitions = collectLevelTransitions(update, initial, settings, { cards });
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].actor, 'Ada');
    assert.equal(transitions[0].actorId, 'npc:ada');
    const result = await selectLevelGrants(update, initial, settings, 'Victory', [], { cards });
    assert.equal(result.rows.length, 3);
    assert.ok(result.rows.every(row => row.actor === 'Ada'));
    assert.deepEqual(initial.characters, []);
    assert.equal(cards[0].statusOverrides.Experience, '8/10');
});

test('legacy definitions without projected IDs still resolve XP and numeric growth', async () => {
    const settings = { playerStats: [{ name: 'XP', type: 'bar' }, { name: 'Level', type: 'number' },
        { name: 'Aim', type: 'number', advanceOnLevel: true }],
        progression: { player: { statGrowth: 'all', statIds: ['aim'] } } };
    const result = await selectLevelGrants({ player: { stats: { XP: '10/10' } } },
        { player: { stats: { XP: '9/10', Level: '1', Aim: '2' } } }, settings, 'Victory');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].label, 'Aim');
    assert.equal(result.rows[0].grant.statId, 'aim');
});

test('one-stat selection excludes depleted pools already at their hard capacity bound', async () => {
    const settings = tracker(); settings.progression.player.statGrowth = 'one';
    settings.playerStats.find(def => def.id === 'hp').maxStatValue = 10;
    const result = await selectLevelGrants({ player: { stats: { Experience: '10/10' } } }, state(), settings, 'Victory', [], {
        requestExtraction: async prompt => {
            const task = JSON.parse(prompt).tasks[0];
            assert.deepEqual(task.eligibleStats.map(def => def.id), ['power']);
            return { choices: [{ id: task.id, statId: 'power', amount: 1 }] };
        } });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].label, 'Power');
});

test('batch schema uses provider-compatible keywords and owner-specific objects; keyed no-reward replies are valid', async () => {
    const settings = tracker(); settings.collections = [collection('guided')];
    settings.progression.player.statGrowth = 'one';
    const result = await selectLevelGrants(parsed(), state(), settings, 'Victory', [], {
        requestExtraction: async (prompt, schema) => {
            const tasks = JSON.parse(prompt).tasks;
            const visit = node => {
                for (const [keyword, value] of Object.entries(node)) {
                    assert.ok(['type', 'properties', 'required', 'items'].includes(keyword), `Unsupported schema keyword: ${keyword}`);
                    if (keyword === 'properties') Object.values(value).forEach(visit);
                    if (keyword === 'items') visit(value);
                }
            };
            visit(schema);
            const shape = schema.properties.choices.properties;
            assert.equal(schema.properties.choices.type, 'object');
            for (const task of tasks) {
                if (task.type === 'stat') {
                    assert.equal(shape[task.id].properties.amount.type, 'number');
                    assert.equal(shape[task.id].properties.entry, undefined);
                } else {
                    assert.equal(shape[task.id].properties.entry.properties.Technique.type, 'string');
                    assert.equal(shape[task.id].properties.entry.properties.Power.type, 'number');
                    assert.equal(shape[task.id].properties.statId, undefined);
                }
            }
            return { choices: Object.fromEntries(tasks.map(task => [task.id, task.type === 'stat'
                ? { statId: 'hp', amount: 2 } : task.recipient === 'Ada'
                    ? { noReward: true } : { entry: { Technique: `Skill ${task.level}`, Power: 2 } }])) };
        } });
    assert.equal(result.failures.length, 0);
    assert.equal(result.rows.length, 6);
    assert.equal(result.rows.filter(row => row.kind === 'item-add').length, 2);
});
