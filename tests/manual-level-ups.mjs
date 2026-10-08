import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createManualLevelUpService, MANUAL_LEVEL_UPS_KEY } from '../src/tracker/manual-level-up-logic.js';
import { progressXp } from '../src/tracker/progression.js';

const diffSource = readFileSync(new URL('../src/tracker/status-diff-review.js', import.meta.url), 'utf8');
const splitValue = value => { const [current, max = ''] = String(value ?? '').split('/'); return { current, max }; };
const buildUpdate = new Function('splitValue', 'debugLog', 'primaryFieldName', 'itemKey',
    diffSource.replace(/^import .*;\n/gm, '').replace(/export /g, '') + '\nreturn buildUpdateFromChanges;')
    (splitValue, () => {}, collection => collection.fields[0].name, (item, primary) => item[primary]);

function harness({ offstage = false, manual = false, guided = false } = {}) {
    const definitions = [
        { id: 'xp', name: 'Experience', type: 'number', defaultValue: '0/20' },
        { id: 'lv', name: 'Rank', type: 'number', defaultValue: '', locked: true },
        { id: 'mana', name: 'Mana', type: 'number', defaultValue: '10/10' },
        { id: 'power', name: 'Power', type: 'number', defaultValue: '', maxStatValue: '255' },
    ];
    const config = { enabled: true, xpFieldId: 'xp', levelFieldId: 'lv', statIds: ['mana', 'power'],
        pointsPerLevel: 3, assignment: manual ? 'manual' : 'random' };
    const tracker = { npcStats: definitions, npcTemplates: [{ id: 'mage', statIds: definitions.map(def => def.id), progression: config }],
        playerStats: [], collections: guided ? [{ id: 'spells', name: 'Spells', targets: ['template:mage'],
            fields: [{ id: 'name', name: 'Name', type: 'text', isPrimary: true }],
            levelUpRewards: { enabled: true, mode: 'guided', interval: 1 } }] : [] };
    const settings = { enabled: true, activeSystem: 'magic', statusTracker: tracker };
    const card = { id: 'mira', name: 'Mira', npcTemplateId: 'mage', statusCollections: {},
        statusOverrides: { Experience: '14/20', Rank: '1', Mana: '6/10', Power: '254/255' } };
    const state = { player: { stats: {} }, characters: offstage ? [] : [{ id: card.id, name: card.name,
        npcTemplateId: card.npcTemplateId, stats: { ...card.statusOverrides }, collections: {} }] };
    const context = { chat: [{ mes: 'Mira practices magic.', is_user: false }], chatMetadata: {}, getCurrentChatId: () => 'chat-a' };
    const writes = [], saves = [];
    let persona = 'persona-a', sequence = 0, request = () => assert.fail('Numeric level-ups must not request a model');
    const deps = { getContext: () => context, getSettings: () => settings, getCards: () => [card],
        getPersonaId: () => persona, loadState: () => state, newId: () => String(++sequence), random: () => 0,
        buildUpdate, save: () => saves.push(true), requestExtraction: (...args) => request(...args),
        applyUpdate: (update, options) => {
            writes.push({ update: structuredClone(update), options });
            for (const proposal of update.characters || []) {
                const scene = state.characters.find(actor => actor.name === proposal.name);
                const values = scene?.stats || card.statusOverrides;
                const incoming = { ...proposal.stats };
                if (!options.progressionResolved && incoming.Experience !== undefined) {
                    const progressed = progressXp(values.Experience, incoming.Experience, values.Rank);
                    incoming.Experience = progressed.xp; incoming.Rank = progressed.level;
                }
                Object.assign(values, incoming); Object.assign(card.statusOverrides, incoming);
                if (proposal.collections?.spells?.replace) {
                    card.statusCollections.spells = structuredClone(proposal.collections.spells.replace);
                    if (scene) scene.collections.spells = structuredClone(card.statusCollections.spells);
                }
            }
            return state;
        },
    };
    return { service: createManualLevelUpService(deps), settings, config, tracker, card, state, context, writes, saves,
        setPersona: value => { persona = value; }, setRequest: fn => { request = fn; } };
}

test('Trigger Level-up advances once, preserves XP, and grows any configured pool through reward review', async () => {
    const h = harness();
    const record = await h.service.trigger(h.card.id);
    assert.equal(h.card.statusOverrides.Rank, '2');
    assert.equal(h.card.statusOverrides.Experience, '14/20');
    assert.equal(h.card.statusOverrides.Mana, '6/10', 'Rewards await review');
    assert.equal(record.pending[0].grant.points, 3);
    assert.deepEqual(record.pending[0].allocations, { mana: 3 });
    assert.equal(h.writes[0].options.partOfMessage, undefined, 'Manual actions must not rewrite story turn records');
    h.service.resolve(h.card.id, record.id, record.pending);
    assert.equal(h.card.statusOverrides.Mana, '9/13');
    assert.equal(h.card.statusOverrides.Experience, '14/20');
    assert.equal(h.service.records(h.card.id).length, 0);
    const writes = h.writes.length;
    h.service.resolve(h.card.id, record.id, record.pending);
    assert.equal(h.writes.length, writes);
});

test('offstage NPCs advance and spend points without entering the scene', async () => {
    const h = harness({ offstage: true });
    const record = await h.service.trigger(h.card.id);
    h.service.resolve(h.card.id, record.id, record.pending);
    assert.deepEqual(h.state.characters, []);
    assert.equal(h.card.statusOverrides.Rank, '2');
    assert.equal(h.card.statusOverrides.Mana, '9/13');
});

test('an existing scene identity is preserved when it differs from the saved card ID', async () => {
    const h = harness();
    h.state.characters[0].id = 'scene-mira';
    const record = await h.service.trigger(h.card.id);
    assert.equal(record.pending[0].grant.actorId, 'npc:scene-mira');
    h.service.resolve(h.card.id, record.id, record.pending);
    assert.equal(h.card.statusOverrides.Mana, '9/13');
    assert.equal(h.service.records(h.card.id).length, 0);
});

test('manual budgets persist across later manual level-ups and stale confirmations cannot spend twice', async () => {
    const h = harness({ manual: true });
    const first = await h.service.trigger(h.card.id);
    const original = first.pending[0];
    h.service.resolve(h.card.id, first.id, [{ ...original, allocations: { mana: 2 } }]);
    assert.equal(first.pending[0].grant.points, 1);
    const second = await h.service.trigger(h.card.id);
    assert.equal(h.card.statusOverrides.Rank, '3');
    assert.equal(h.service.records(h.card.id).length, 2);
    const writes = h.writes.length;
    h.service.resolve(h.card.id, first.id, [{ ...original, allocations: { mana: 2 } }]);
    assert.equal(h.writes.length, writes);
    h.context.chatMetadata = JSON.parse(JSON.stringify(h.context.chatMetadata));
    const restored = h.service.records(h.card.id).find(record => record.id === first.id);
    h.service.resolve(h.card.id, first.id, [{ ...restored.pending[0], allocations: { mana: 1 } }]);
    assert.equal(h.card.statusOverrides.Mana, '9/13');
    assert.deepEqual(h.service.records(h.card.id).map(record => record.id), [second.id]);
    h.service.resolve(h.card.id, second.id, [], { discardAll: true });
    assert.equal(h.service.records(h.card.id).length, 0);
    assert.equal(h.card.statusOverrides.Rank, '3', 'Discard rewards leaves the explicitly triggered level intact');
});

test('no growth still advances, while invalid counters, missing chat and disabled progression reject without writes', async () => {
    const h = harness(); h.config.pointsPerLevel = 0;
    await h.service.trigger(h.card.id);
    assert.equal(h.card.statusOverrides.Rank, '2'); assert.equal(h.service.records(h.card.id).length, 0);
    for (const change of [
        h => { h.context.getCurrentChatId = () => undefined; },
        h => { h.settings.enabled = false; },
        h => { h.config.enabled = false; },
        h => { h.card.statusOverrides.Rank = ''; h.state.characters[0].stats.Rank = ''; },
        h => { h.card.statusOverrides.Experience = '20/20'; h.state.characters[0].stats.Experience = '20/20'; },
        h => { h.tracker.npcStats[1].maxStatValue = '1'; },
    ]) {
        const invalid = harness(); change(invalid);
        assert.equal(invalid.service.info(invalid.card.id).enabled, false);
        await assert.rejects(invalid.service.trigger(invalid.card.id));
        assert.equal(invalid.writes.length, 0);
    }
});

test('guided rewards retry independently of counters and numeric budgets, even after another level-up', async () => {
    const h = harness({ guided: true });
    h.setRequest(async () => { throw new Error('offline'); });
    const first = await h.service.trigger(h.card.id);
    assert.equal(first.failures.length, 1); assert.equal(first.pending.length, 1);
    h.service.resolve(h.card.id, first.id, first.pending);
    assert.equal(h.card.statusOverrides.Mana, '9/13');
    h.config.pointsPerLevel = 0;
    await h.service.trigger(h.card.id);
    h.setRequest(async prompt => {
        const tasks = JSON.parse(prompt).tasks;
        assert.equal(tasks.length, 1); assert.equal(tasks[0].type, 'collection');
        return { choices: { [tasks[0].id]: { entry: { Name: 'Flash' } } } };
    });
    assert.equal(await h.service.retry(h.card.id, first.id), true);
    assert.equal(h.card.statusOverrides.Rank, '3'); assert.equal(h.card.statusOverrides.Experience, '14/20');
    h.service.resolve(h.card.id, first.id, first.pending);
    assert.deepEqual(h.card.statusCollections.spells, [{ Name: 'Flash' }]);
});

test('async triggers cannot affect a changed chat or persona, and duplicate clicks are rejected', async () => {
    for (const steer of [
        h => { h.context.chatMetadata = {}; h.context.getCurrentChatId = () => 'chat-b'; },
        h => { h.setPersona('persona-b'); },
        h => { h.settings.activeSystem = 'other'; },
        h => { h.state.characters[0].stats.Experience = '15/20'; },
    ]) {
        const h = harness({ guided: true });
        let finish;
        h.setRequest(() => new Promise(resolve => { finish = resolve; }));
        const action = h.service.trigger(h.card.id);
        await assert.rejects(h.service.trigger(h.card.id), /already running/);
        steer(h); finish({ choices: {} });
        await assert.rejects(action, /changed/);
        assert.equal(h.writes.length, 0); assert.equal(h.service.isBusy(h.card.id), false);
    }
});

test('pending manual rewards are scoped to the chat system and persona', async () => {
    const h = harness({ manual: true });
    await h.service.trigger(h.card.id);
    assert.ok(h.context.chatMetadata[MANUAL_LEVEL_UPS_KEY][h.card.id].length);
    h.setPersona('persona-b'); assert.equal(h.service.records(h.card.id).length, 0);
    h.setPersona('persona-a'); h.settings.activeSystem = 'other'; assert.equal(h.service.records(h.card.id).length, 0);
    h.settings.activeSystem = 'magic'; assert.equal(h.service.records(h.card.id).length, 1);
});
