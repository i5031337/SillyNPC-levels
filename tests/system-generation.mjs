import test from 'node:test';
import assert from 'node:assert/strict';
import { SystemGenerationRun } from '../src/generation/generate-system.js';
import { definitionSchema, presentationSchema, profileSchema } from '../src/generation/contracts.js';
import { allocatePlan } from '../src/generation/plan.js';
import { validateDefinition, finalizeDefinition } from '../src/generation/validate-definition.js';
import { parseResponse } from '../src/generation/validate-shape.js';
import { createDraftContext } from '../src/generation/draft-context.js';
import { plan, responseFor } from './fixtures/system-generation.mjs';
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
    assert.equal(result.definition.stats.character.find(f => f.id === 'energy').isPrimary, true);
    assert.equal(result.definition.npcTemplates[0].progression.enabled, true);
    assert.equal(calls[0].stage, 'plan');
    assert.ok(calls.findIndex(c => c.stage === 'rewards.techniques') > calls.findIndex(c => c.stage === 'stats.character'));
    assert.equal(calls.some(c => /^(template\.|progression\.|presentation)/.test(c.stage)), false);
    assert.equal(calls.length, 6);
    assert.equal(calls.filter(c => c.stage === 'assembly').length, 0);
    assert.equal(result.usage.requests, calls.length);
    assert.ok(result.usage.promptChars > 0 && result.usage.replyChars > 0);
    assert.equal(events.at(-1).stage, 'Draft ready');
    assert.deepEqual(finalizeDefinition(result.definition).definition, result.definition);
});

test('malformed shared catalog repairs once; retry preserves accepted work', async () => {
    const calls = []; let fail = true;
    const run = runWith(args => { calls.push(args.stage); return fail && args.stage === 'stats.character' ? '{"section": [' : reply(args); });
    await assert.rejects(run.generate(), /truncated/);
    const world = structuredClone(run.definition.stats.world);
    fail = false; await run.generate();
    assert.equal(calls.filter(stage => stage === 'stats.world').length, 1);
    for (const [key, value] of Object.entries(world[0])) assert.deepEqual(run.definition.stats.world[0][key], value);
});

test('progression growth candidates cannot include counters', async () => {
    const run = runWith(async args => {
        const output = reply(args);
        if (args.stage === 'stats.character') output.section.progression.creature.statIds = ['level'];
        return output;
    });
    await assert.rejects(run.generate(), /unsupported value "level"/);
    assert.equal(run.failed, 'stats.character');
    assert.equal(run.definition.npcTemplates[0].progression.enabled, false);
});

test('NPC catalog requests pin shared IDs and repair invented archetype suffixes', async () => {
    const calls = [];
    const run = runWith(args => {
        calls.push(args);
        const output = reply(args);
        if (args.stage === 'stats.character' && calls.filter(c => c.stage === args.stage).length === 1) {
            output.section.fields = ['stamina_h', 'stamina_c', 'xp_c', 'lvl_c', 'f_c'].map(id => ({ ...output.section.fields[0], id }));
        }
        return output;
    });
    const { definition } = await run.generate();
    const requests = calls.filter(c => c.stage === 'stats.character');
    assert.equal(requests.length, 2);
    const body = JSON.parse(requests[0].userPrompt);
    assert.deepEqual(body.expectedObjects, registry.stats.character);
    assert.equal(body.plan, undefined);
    assert.deepEqual(body.progressionOwners[1].statIds, ['xp', 'level', 'vigor']);
    assert.match(requests[0].systemPrompt, /ONE SHARED character catalog/);
    const schema = requests[0].schema.properties.section.properties.fields;
    assert.deepEqual(schema.items.properties.id.enum, ['xp', 'level', 'energy', 'vigor']);
    assert.equal(schema.minItems, 4);
    assert.equal(schema.maxItems, 4);
    const repair = JSON.parse(requests[1].userPrompt).repair;
    assert.ok(repair.errors.some(error => error.includes('stamina_h') && error.includes('"xp"')));
    assert.deepEqual(definition.stats.character.map(field => field.id), ['xp', 'level', 'energy', 'vigor']);
    assert.equal(calls.filter(c => c.stage === 'stats.character').length, 2);
    // Reused schema fragments must narrow independently at every reference path.
    const config = requests[0].schema.properties.section.properties.progression.properties.creature;
    assert.deepEqual(config.properties.xpFieldId.enum, ['xp']);
    assert.deepEqual(config.properties.levelFieldId.enum, ['level']);
    assert.deepEqual(config.properties.statIds.items.enum, ['vigor']);
    assert.equal(Object.hasOwn(definition.npcTemplates[0], 'statIds'), false);
    assert.deepEqual(definition.profiles.find(f => f.id === 'species').targets, ['template:creature']);
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
        if (invalid && args.stage === 'stats.character') {
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
    assert.equal(run.failed, 'stats.character');
    assert.equal(run.accepted.has('stats.character'), false);
    assert.equal(run.definition.progression.player.enabled, false);
    assert.equal(run.definition.stats.character.length, 0);
    assert.equal(calls.includes('collection.techniques'), false);
    invalid = false;
    const result = await run.generate();
    assert.equal(calls.filter(stage => stage === 'profiles').length, 1);
    assert.equal(result.definition.progression.player.enabled, true);
    assert.deepEqual(validateDefinition(result.definition), []);
});

test('two-template two-collection adventure uses six model calls without repairs', async () => {
    const compact = structuredClone(plan);
    compact.npcTemplates.push({ name: 'Human', description: 'Rivals and leaders', progression: { enabled: true, xp: 'XP', level: 'Level', growth: 'No stat growth' } });
    compact.stats.character.filter(f => ['XP', 'Level'].includes(f.name)).forEach(f => f.targets.push('Human'));
    compact.collections[0].rewards = 'none';
    compact.collections.push({ name: 'Items', purpose: 'Inventory', targets: ['player'], trackQuantity: true,
        fields: [{ name: 'Name', purpose: 'Identifier' }, { name: 'Quantity', purpose: 'Owned quantity' }], rewards: 'none' });
    const allocated = allocatePlan(compact), calls = [], events = [];
    const run = new SystemGenerationRun({ premise: 'Basic monster adventure', onProgress: event => events.push(event), request: args => {
        calls.push(args.stage);
        return args.stage === 'plan' ? { section: compact, assumptions: [] } : responseFor(args.stage, allocated);
    } });
    const { definition } = await run.generate();
    assert.equal(calls.length, 6);
    assert.equal(events.at(-1).total, 6);
    assert.equal(events.at(-1).index, 6);
    assert.ok(events.filter(event => event.total).every(event => event.total === 6));
    assert.equal(definition.npcTemplates.length, 2);
    assert.equal(definition.npcTemplates.find(t => t.id === 'human').progression.pointsPerLevel, 0);
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
    const bad = structuredClone(plan); bad.stats.character.push({ name: 'xp', purpose: 'Another XP', targets: ['player'] });
    assert.throws(() => allocatePlan(bad), /unambiguous/);
    const renamed = structuredClone(plan); renamed.stats.character[0].name = 'Training Points'; renamed.playerProgression.xp = 'Training Points'; renamed.npcTemplates[0].progression.xp = 'Training Points';
    assert.equal(allocatePlan(renamed).playerProgression.xpFieldId, 'training-points');
    assert.deepEqual(allocatePlan(plan), registry); assert.ok(Object.isFrozen(registry.stats.character));
});

test('strict validation rejects semantic corruption before normalization can repair it', async () => {
    const { definition } = await runWith(reply).generate();
    const corruptions = [
        d => { d.stats.character[0].defaultValue = '0/0'; },
        d => { d.stats.character[0].formula = 'level * 10'; },
        d => { d.stats.character[2].min = '20'; },
        d => { d.stats.character[2].defaultValue = '20/10'; },
        d => { d.stats.character[0].targets = ['template:missing']; },
        d => { d.stats.character[1].updatePolicy = 'turn'; },
        d => { d.progression.player.increments = { energy: 2 }; },
        d => { d.progression.player.pointsPerLevel = -1; },
        d => { d.progression.player.pointsPerLevel = 1.5; },
        d => { d.progression.player.assignment = 'llm'; },
        d => { d.progression.player.statIds = ['xp']; },
        d => { d.collections[0].targets = ['template:missing']; },
        d => { d.collections[0].fields[1].isPrimary = true; },
        d => { d.collections[0].fields[0].isStatic = false; },
        d => { d.collections[0].levelUpRewards.schedule[0].entry.power = 4; },
        d => { d.collections[0].levelUpRewards.schedule[0].entry.unknown = 'bad'; },
        d => { d.hud.playerStatIds = ['missing']; },
        d => { d.stats.character[2].guidance = '<img src=x onerror=alert(1)>'; },
        d => { d.characters = [{ name: 'An actual monster' }]; },
        d => { d.stats.character[0].format = '{{eval}}'; },
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
    assert.equal(changed.stats.character[2].name, 'Focus');
    assert.ok(validateDefinition(changed).length);
    assert.deepEqual(changed.progression.player.statIds, ['energy']);
    assert.equal(context.renameCollectionField('techniques', 'name', 'title'), 0);
});

test('draft may retain reusable fields after their sole template is removed', async () => {
    const { definition } = await runWith(reply).generate();
    const context = createDraftContext(definition);
    const draft = context.definition();
    draft.npcTemplates = [];
    for (const field of [...draft.stats.character, ...draft.profiles]) field.targets = field.targets.filter(target => !target.startsWith('template:'));
    context.getSettings().statusTracker.collections[0].targets = ['player'];
    const changed = context.capture();
    assert.deepEqual(validateDefinition(changed), []);
    assert.deepEqual(changed.profiles.find(field => field.id === 'species').targets, []);
});

test('catalog stage cannot silently change planned field assignments', async () => {
    const run = runWith(args => {
        const result = reply(args);
        if (args.stage === 'profiles') result.section[0].targets = ['npc'];
        return result;
    });
    await assert.rejects(run.generate(), /targets: must match planned targets/);
    assert.equal(run.failed, 'profiles');
});

test('legacy same-named definitions remain valid when actor assignments are disjoint', async () => {
    const { definition } = await runWith(reply).generate();
    const xp = definition.stats.character.find(field => field.id === 'xp');
    xp.targets = ['player'];
    const npcXp = { ...xp, id: 'xp-npc', defaultValue: '0/200', maxStatValue: '200', targets: ['template:creature'] };
    definition.stats.character.push(npcXp);
    definition.npcTemplates[0].progression.xpFieldId = 'xp-npc';
    definition.hud.npcStatIds = definition.hud.npcStatIds.map(id => id === 'xp' ? 'xp-npc' : id);
    const profile = definition.profiles[0];
    definition.profiles.push({ ...profile, id: 'background-npc', legacyId: 'background', targets: ['template:creature'] });
    definition.legacyNpcTemplateId = 'creature';
    assert.deepEqual(validateDefinition(definition), []);
    assert.deepEqual(finalizeDefinition(definition).errors, []);
    npcXp.targets.push('player');
    assert.ok(validateDefinition(definition).some(error => error.includes('duplicate XP for overlapping targets')));
});

test('legacy template named player retains NPC-specific counter assignments', async () => {
    const { definition } = await runWith(reply).generate();
    definition.npcTemplates[0].id = 'player';
    definition.progression.player.enabled = false;
    for (const field of [...definition.stats.character, ...definition.profiles])
        field.targets = field.targets.filter(target => target !== 'player').map(target => target === 'template:creature' ? 'template:player' : target);
    definition.hud.playerStatIds = [];
    definition.collections[0].targets = ['template:player'];
    assert.deepEqual(validateDefinition(definition), []);
});

test('response parser rejects truncation and handles prose/fences', () => {
    assert.deepEqual(parseResponse('```json\n{"section": {}, "assumptions": []}\n```'), { section: {}, assumptions: [] });
    assert.throws(() => parseResponse('{"section": {"partial": "foo"}'), /truncated/);
    assert.throws(() => parseResponse('[]'), /Malformed/);
});

test('minimal System needs only planning; guided rewards and independent NPC policies work', async () => {
    const minimal = structuredClone(plan);
    minimal.profiles = []; minimal.stats = { world: [], character: [] };
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
        const result = reply(args); if (args.stage === 'stats.character') result.definition = {}; return result;
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
    const xp = definition.stats.character.find(f => f.id === progression.xpFieldId);
    const level = definition.stats.character.find(f => f.id === progression.levelFieldId);
    assert.deepEqual(progressXp(xp.defaultValue, '250/100', level.defaultValue), { xp: '50/100', level: '3', levelsGained: 2 });
    const energy = definition.stats.character.find(f => f.id === progression.statIds[0]);
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


test('generation plans genre memory rules without extra calls or memory profile fields', async () => {
    const calls = [];
    const { definition } = await runWith(args => { calls.push(args); return reply(args); }).generate();
    assert.deepEqual(definition.memories, plan.memories);
    assert.equal(calls.length, 6);
    assert.match(calls[0].systemPrompt, /Never plan a Memory profile field/);
    assert.equal(Object.hasOwn(profileSchema.properties, 'policy'), false);
    assert.ok(definition.profiles
        .every(field => !Object.hasOwn(field, 'policy')));
    const unsupported = structuredClone(definition);
    unsupported.profiles[0].policy = 'unused';
    assert.ok(validateDefinition(unsupported).some(error => error.includes('policy')));
    for (const mutation of [
        memories => { memories.enabled = 'yes'; },
        memories => { memories.interval = 0; },
        memories => { memories.interval = 101; },
        memories => { memories.maxEntriesPerCharacter = 501; },
        memories => { memories.guidance = 'x'.repeat(4001); },
    ]) {
        const bad = structuredClone(definition);
        mutation(bad.memories);
        assert.ok(validateDefinition(bad).some(error => error.includes('memories')));
        assert.equal(finalizeDefinition(bad).definition, null);
    }
});
