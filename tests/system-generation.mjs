import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemGenerationRun } from '../src/generation/generate-system.js';
import { definitionSchema, presentationSchema } from '../src/generation/contracts.js';
import { allocatePlan } from '../src/generation/plan.js';
import { validateDefinition, finalizeDefinition } from '../src/generation/validate-definition.js';
import { parseResponse } from '../src/generation/validate-shape.js';
import { createDraftContext } from '../src/generation/draft-context.js';
import { plan, responseFor } from './system-generation-fixture.mjs';
const registry = allocatePlan(plan);
const runWith = request => new SystemGenerationRun({ premise: 'A monster catching expedition.', request });
const reply = ({ stage }) => responseFor(stage, registry);

test('staged generation assembles canonical System with template progression and typed rewards', async () => {
    const calls = [], events = [];
    const run = new SystemGenerationRun({ premise: 'Monsters', request: async args => { calls.push(args); return reply(args); }, onProgress: value => events.push(value) });
    const result = await run.generate();
    assert.deepEqual(validateDefinition(result.definition), []);
    assert.equal(result.definition.collections[0].levelUpRewards.schedule[0].entry.power, 2);
    assert.deepEqual(result.definition.collections[0].targets, ['player', 'template:creature']);
    assert.equal(result.definition.stats.player.find(f => f.id === 'energy').isPrimary, true);
    assert.equal(result.definition.npcTemplates[0].progression.enabled, true);
    assert.equal(calls[0].stage, 'plan');
    assert.ok(calls.findIndex(c => c.stage === 'rewards.techniques') > calls.findIndex(c => c.stage === 'stats.npc'));
    assert.equal(calls.some(c => /^(template\.|progression\.|presentation)/.test(c.stage)), false);
    assert.equal(calls.length, 8);
    assert.equal(calls.filter(c => c.stage === 'assembly').length, 0);
    assert.equal(result.usage.requests, calls.length);
    assert.ok(result.usage.promptChars > 0 && result.usage.replyChars > 0);
    assert.equal(events.at(-1).stage, 'Draft ready');
    assert.deepEqual(finalizeDefinition(result.definition).definition, result.definition);
});

test('malformed section repairs once; manual retry preserves all accepted work and IDs', async () => {
    const calls = []; let fail = true;
    const run = runWith(async args => {
        calls.push(args);
        if (fail && args.stage === 'stats.npc') return '{"section": [';
        return reply(args);
    });
    await assert.rejects(run.generate(), /truncated/);
    assert.equal(calls.filter(c => c.stage === 'stats.npc').length, 2);
    assert.ok(run.accepted.has('stats.player'));
    const before = structuredClone(run.definition.stats.player);
    fail = false;
    await run.generate();
    assert.equal(calls.filter(c => c.stage === 'stats.player').length, 1);
    for (const stat of before) {
        const final = run.definition.stats.player.find(field => field.id === stat.id);
        for (const [key, value] of Object.entries(stat)) assert.deepEqual(final[key], value);
    }
});

test('progression growth candidates cannot include counters', async () => {
    const run = runWith(async args => {
        const output = reply(args);
        if (args.stage === 'stats.npc') output.section.progression.creature.statIds = ['level'];
        return output;
    });
    await assert.rejects(run.generate(), /unsupported value "level"/);
    assert.equal(run.failed, 'stats.npc');
    assert.equal(run.definition.npcTemplates[0].progression.enabled, false);
});

test('NPC catalog requests pin shared IDs and repair invented archetype suffixes', async () => {
    const calls = [];
    const run = runWith(args => {
        calls.push(args);
        const output = reply(args);
        if (args.stage === 'stats.npc' && calls.filter(c => c.stage === args.stage).length === 1) {
            output.section.fields = ['stamina_h', 'stamina_c', 'xp_c', 'lvl_c', 'f_c'].map(id => ({ ...output.section.fields[0], id }));
        }
        return output;
    });
    const { definition } = await run.generate();
    const requests = calls.filter(c => c.stage === 'stats.npc');
    assert.equal(requests.length, 2);
    const body = JSON.parse(requests[0].userPrompt);
    assert.deepEqual(body.expectedObjects, registry.stats.npc);
    assert.equal(body.plan, undefined);
    assert.deepEqual(body.progressionOwners[0].statIds, ['xp', 'level', 'vigor']);
    assert.match(requests[0].systemPrompt, /ONE SHARED NPC catalog/);
    const schema = requests[0].schema.properties.section.properties.fields;
    assert.deepEqual(schema.items.properties.id.enum, ['xp', 'level', 'vigor']);
    assert.equal(schema.minItems, 3);
    assert.equal(schema.maxItems, 3);
    const repair = JSON.parse(requests[1].userPrompt).repair;
    assert.ok(repair.errors.some(error => error.includes('stamina_h') && error.includes('"xp"')));
    assert.deepEqual(definition.stats.npc.map(field => field.id), ['xp', 'level', 'vigor']);
    assert.equal(calls.filter(c => c.stage === 'stats.player').length, 1);
    // Reused schema fragments must narrow independently at every reference path.
    const config = requests[0].schema.properties.section.properties.progression.properties.creature;
    assert.deepEqual(config.properties.xpFieldId.enum, ['xp']);
    assert.deepEqual(config.properties.levelFieldId.enum, ['level']);
    assert.deepEqual(config.properties.statIds.items.enum, ['vigor']);
    assert.deepEqual(definition.npcTemplates[0].profileIds, ['species']);
    assert.deepEqual(definition.npcTemplates[0].statIds, ['xp', 'level', 'vigor']);
    const collection = calls.find(c => c.stage === 'collection.techniques').schema.properties.section;
    assert.deepEqual(collection.properties.id.enum, ['techniques']);
    assert.deepEqual(collection.properties.fields.items.properties.id.enum, ['name', 'power']);
    const collectionBody = JSON.parse(calls.find(c => c.stage === 'collection.techniques').userPrompt);
    assert.deepEqual(collectionBody.dependencies, {});
    assert.deepEqual(collectionBody.npcTemplates.map(template => template.id), ['creature']);
    assert.equal(collectionBody.npcTemplates[0].progression.enabled, true);
    const rewardBody = JSON.parse(calls.find(c => c.stage === 'rewards.techniques').userPrompt);
    assert.equal(Object.hasOwn(rewardBody.dependencies, 'stats.world'), false);
    assert.deepEqual(definition.hud.playerStatIds, ['xp', 'level', 'energy']);
    assert.deepEqual(definition.hud.worldStatIds, ['location']);
});

test('invalid XP is repaired with its stats, before progression or dependents are accepted', async () => {
    const calls = []; let invalid = true;
    const run = runWith(args => {
        calls.push(args.stage);
        const output = reply(args);
        if (invalid && args.stage === 'stats.player') {
            output.section.fields.find(field => field.id === 'xp').defaultValue = '0';
            output.section.fields.find(field => field.id === 'xp').maxStatValue = '';
            const body = JSON.parse(args.userPrompt);
            if (body.repair) {
                assert.ok(body.repair.errors.some(error => error.includes('XP field xp defaultValue "0"')));
                assert.ok(body.repair.errors.some(error => error.includes('maxStatValue ""')));
            }
        }
        return output;
    });
    await assert.rejects(run.generate(), /remainder\/capacity/);
    assert.equal(run.failed, 'stats.player');
    assert.equal(run.accepted.has('stats.player'), false);
    assert.equal(run.definition.progression.player.enabled, false);
    assert.equal(run.definition.stats.player.length, 0);
    assert.equal(calls.includes('stats.npc'), false);
    invalid = false;
    const result = await run.generate();
    assert.equal(calls.filter(stage => stage === 'profiles.player').length, 1);
    assert.equal(result.definition.progression.player.enabled, true);
    assert.deepEqual(validateDefinition(result.definition), []);
});

test('two-template two-collection adventure uses eight model calls without repairs', async () => {
    const compact = structuredClone(plan);
    compact.npcTemplates.push({ name: 'Human', description: 'Rivals and leaders', profiles: ['Species'], stats: ['XP', 'Level'],
        progression: { enabled: true, xp: 'XP', level: 'Level', growth: 'No stat growth' } });
    compact.collections[0].rewards = 'none';
    compact.collections.push({ name: 'Items', purpose: 'Inventory', targets: ['player'],
        fields: [{ name: 'Name', purpose: 'Identifier' }, { name: 'Quantity', purpose: 'Owned quantity' }], rewards: 'none' });
    const allocated = allocatePlan(compact), calls = [], events = [];
    const run = new SystemGenerationRun({ premise: 'Basic monster adventure', onProgress: event => events.push(event), request: args => {
        calls.push(args.stage);
        return args.stage === 'plan' ? { section: compact, assumptions: [] } : responseFor(args.stage, allocated);
    } });
    const { definition } = await run.generate();
    assert.equal(calls.length, 8);
    assert.equal(events.at(-1).total, 8);
    assert.equal(events.at(-1).index, 8);
    assert.ok(events.filter(event => event.total).every(event => event.total === 8));
    assert.equal(definition.npcTemplates.length, 2);
    assert.equal(definition.npcTemplates.find(t => t.id === 'human').progression.statGrowth, 'none');
    assert.equal(definition.collections.length, 2);
    assert.deepEqual(validateDefinition(definition), []);
});

test('cancellation returns promptly, prevents dependent requests and ignores late response', async () => {
    let resolve; const calls = [];
    const run = runWith(async args => { calls.push(args.stage); if (args.stage === 'stats.world') return new Promise(r => { resolve = r; }); return reply(args); });
    const controller = new AbortController(); const pending = run.generate({ signal: controller.signal });
    while (!resolve) await new Promise(r => setTimeout(r, 1));
    controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
    resolve(responseFor('stats.world', registry)); await new Promise(r => setTimeout(r, 5));
    assert.equal(run.accepted.has('stats.world'), false);
    assert.equal(calls.at(-1), 'stats.world');
    assert.equal(run.complete, false);
});

test('ambiguous plans reject references before defining catalogs; IDs deterministic and frozen', () => {
    const bad = structuredClone(plan); bad.stats.npc.push({ name: 'xp', purpose: 'Another XP' });
    assert.throws(() => allocatePlan(bad), /unambiguous/);
    const renamed = structuredClone(plan); renamed.stats.player[0].name = 'Training Points'; renamed.playerProgression.xp = 'Training Points';
    assert.equal(allocatePlan(renamed).playerProgression.xpFieldId, 'training-points');
    assert.deepEqual(allocatePlan(plan), registry); assert.ok(Object.isFrozen(registry.stats.player));
});

test('strict validation rejects semantic corruption before normalization can repair it', async () => {
    const { definition } = await runWith(reply).generate();
    const corruptions = [
        d => { d.stats.player[0].defaultValue = '0/0'; },
        d => { d.stats.player[0].formula = 'level * 10'; },
        d => { d.stats.player[2].min = '20'; },
        d => { d.stats.player[2].defaultValue = '20/10'; },
        d => { d.npcTemplates[0].statIds.push('missing'); },
        d => { d.stats.npc[1].updatePolicy = 'turn'; },
        d => { d.progression.player.increments = { energy: 2 }; },
        d => { d.progression.player.statIds = ['xp']; },
        d => { d.collections[0].targets = ['template:missing']; },
        d => { d.collections[0].fields[1].isPrimary = true; },
        d => { d.collections[0].fields[0].isStatic = false; },
        d => { d.collections[0].levelUpRewards.schedule[0].entry.power = 4; },
        d => { d.collections[0].levelUpRewards.schedule[0].entry.unknown = 'bad'; },
        d => { d.hud.playerStatIds = ['missing']; },
        d => { d.stats.player[2].guidance = '<img src=x onerror=alert(1)>'; },
        d => { d.characters = [{ name: 'An actual monster' }]; },
        d => { d.stats.player[0].format = '{{eval}}'; },
        d => { d.collections[0].levelUpRewards.interval = 0; },
        d => { d.collections[0].levelUpRewards.schedule[0].level = 1; },
    ];
    for (const corrupt of corruptions) {
        const bad = structuredClone(definition); corrupt(bad);
        assert.ok(validateDefinition(bad).length, JSON.stringify(bad));
        assert.equal(finalizeDefinition(bad).definition, null);
    }
});

test('draft projection is isolated; errors stay visible rather than normalized away', async () => {
    const { definition } = await runWith(reply).generate();
    const before = structuredClone(definition); let changed;
    const context = createDraftContext(definition, value => { changed = value; });
    context.getSettings().statusTracker.playerStats[2].name = 'Focus';
    context.getSettings().statusTracker.playerStats[2].min = '200';
    context.saveSettings();
    assert.deepEqual(definition, before);
    assert.equal(changed.stats.player[2].name, 'Focus');
    assert.ok(validateDefinition(changed).length);
    assert.deepEqual(changed.progression.player.statIds, ['energy']);
    assert.equal(context.renameCollectionField('techniques', 'name', 'title'), 0);
});

test('response parser rejects truncation and handles prose/fences', () => {
    assert.deepEqual(parseResponse('```json\n{"section": {}, "assumptions": []}\n```'), { section: {}, assumptions: [] });
    assert.throws(() => parseResponse('{"section": {"partial": "foo"}'), /truncated/);
    assert.throws(() => parseResponse('[]'), /Malformed/);
});

test('minimal System needs only planning; guided rewards and independent NPC policies work', async () => {
    const minimal = structuredClone(plan);
    minimal.profiles = { player: [], npc: [] }; minimal.stats = { world: [], player: [], npc: [] };
    minimal.playerProgression = { enabled: false, xp: '', level: '', growth: '' };
    minimal.npcTemplates = []; minimal.collections = [];
    const run = runWith(({ stage }) => {
        assert.equal(stage, 'plan');
        return { section: minimal, assumptions: [] };
    });
    const result = await run.generate(); assert.equal(result.usage.requests, 1);
    assert.equal(result.definition.progression.player.enabled, false);
    const guided = structuredClone(plan); guided.collections[0].rewards = 'guided'; guided.playerProgression.enabled = false;
    const reg = allocatePlan(guided);
    const generated = await runWith(args => {
        if (args.stage === 'plan') return { section: guided, assumptions: [] };
        if (args.stage === 'rewards.techniques') return { section: { enabled: true, mode: 'guided', guidance: 'Choose story-appropriate techniques', interval: 2, schedule: [] }, assumptions: [] };
        return responseFor(args.stage, reg);
    }).generate();
    assert.equal(generated.definition.progression.player.enabled, false);
    assert.equal(generated.definition.npcTemplates[0].progression.enabled, true);
    assert.equal(generated.definition.collections[0].levelUpRewards.interval, 2);
});

test('request limits, excess object counts, unknown section data, and network failures are bounded', async () => {
    const excess = structuredClone(plan); excess.npcTemplates = Array.from({ length: 7 }, () => plan.npcTemplates[0]);
    assert.throws(() => allocatePlan(excess), /too many/);
    const run = runWith(reply); run.usage.requests = 48;
    await assert.rejects(run.generate(), /request limit/);
    let calls = 0;
    await assert.rejects(runWith(() => { calls++; throw new Error('Connection unavailable'); }).generate(), /Connection unavailable/);
    assert.equal(calls, 1);
    const misplaced = runWith(args => {
        const result = reply(args); if (args.stage === 'stats.player') result.definition = {}; return result;
    });
    await assert.rejects(misplaced.generate(), /unsupported field/);
});

test('saved fixture drives normal progression, bounded growth, and scheduled target rewards', async () => {
    const { readFile } = await import('node:fs/promises');
    const { progressXp, boostStat } = await import('../src/tracker/progression.js');
    const { scheduledCollectionRewards, collectionRewardAppliesTo } = await import('../src/core/collection-rewards.js');
    const definition = JSON.parse(await readFile(new URL('./fixtures/generated-expedition-system.json', import.meta.url), 'utf8'));
    assert.deepEqual(validateDefinition(definition), []);
    const progression = definition.progression.player;
    const xp = definition.stats.player.find(f => f.id === progression.xpFieldId);
    const level = definition.stats.player.find(f => f.id === progression.levelFieldId);
    assert.deepEqual(progressXp(xp.defaultValue, '250/100', level.defaultValue), { xp: '50/100', level: '3', levelsGained: 2 });
    const energy = definition.stats.player.find(f => f.id === progression.statIds[0]);
    assert.equal(boostStat(energy.defaultValue, undefined, 2, { growMaximum: true }), '8/12');
    const col = definition.collections[0];
    assert.equal(scheduledCollectionRewards(col, [2, 3]).length, 2);
    assert.equal(collectionRewardAppliesTo(col, 'npc', 'creature'), true);
    assert.equal(collectionRewardAppliesTo(col, 'npc', 'other'), false);
    assert.deepEqual(finalizeDefinition(JSON.parse(JSON.stringify(definition))).definition, definition);
});

test('generated definitions omit removed goal configuration and reject unsupported switches', async () => {
    assert.equal(Object.hasOwn(definitionSchema.properties, 'goals'), false);
    assert.equal(Object.hasOwn(presentationSchema.properties, 'goals'), false);
    const { definition } = await runWith(reply).generate();
    assert.equal(Object.hasOwn(definition, 'goals'), false);
    assert.ok(validateDefinition({ ...definition, goals: { playerShortTerm: true } })
        .some(error => error.includes('goals')));
});
