import test from 'node:test';
import assert from 'node:assert/strict';
import { allocatePlan } from '../src/generation/plan.js';
import { SystemGenerationRun } from '../src/generation/generate-system.js';
import { PLANNING_EXAMPLE } from '../src/generation/planning-prompt.js';
import { plan, responseFor } from './system-generation-fixture.mjs';

// Reproduce Gemma's submitted references without coupling the test to prompt wording.
const gemmaPlan = () => ({
    name: 'Pocket Monster Safari System', description: 'Trainer and creature adventure', rationale: 'Separate human and creature templates',
    profiles: { player: [{ name: 'Trainer', purpose: 'Primary actor' }], npc: [
        { name: 'Humanoid', purpose: 'Social entities' }, { name: 'Wild Creature', purpose: 'Autonomous entities' }] },
    stats: { world: [{ name: 'Environment Type', purpose: 'Elemental modifiers' }],
        player: [{ name: 'Stamina', purpose: 'Travel' }, { name: 'Reputation', purpose: 'Human interaction' }],
        npc: [{ name: 'Combat Power', purpose: 'Offense' }, { name: 'Friendship', purpose: 'Command success' }, { name: 'Energy', purpose: 'Abilities' }] },
    playerProgression: { enabled: true, xp: '0/100', level: '1', growth: 'Travel milestones' },
    npcTemplates: [
        { name: 'Humanoid Template', description: 'Humans and rivals', profiles: ['Humanoid'], stats: ['Stamina', 'Reputation'],
            progression: { enabled: true, xp: '0/100', level: '', growth: 'Competitive victories' } },
        { name: 'Creature Template', description: 'Creatures', profiles: ['Wild Creature'], stats: ['Combat Power', 'Energy', 'Friendship'],
            progression: { enabled: true, xp: '0/100', level: '', growth: 'Combat and bonding' } },
    ], collections: [],
});

test('Gemma counter values and cross-scope memberships produce actionable reference diagnostics', () => {
    const input = gemmaPlan();
    assert.throws(() => allocatePlan(input), error => {
        assert.match(error.message, /playerProgression\.xp: unresolved name "0\/100".*stats\.player.*"Stamina", "Reputation"/);
        assert.match(error.message, /playerProgression\.level: unresolved name "1"/);
        assert.match(error.message, /Humanoid Template\.stats: unresolved name "Stamina".*stats\.npc.*"Combat Power"/);
        assert.match(error.message, /Creature Template\.progression\.level: unresolved name ""/);
        assert.doesNotMatch(error.message, /XP and Level must be distinct/);
        return true;
    });
    assert.deepEqual(gemmaPlan(), input); // No guessed counters or silent scope migration.
});

test('planning example defines every enabled counter in the correct scope and selection', () => {
    const allocated = allocatePlan(PLANNING_EXAMPLE);
    assert.equal(allocated.playerProgression.xpFieldId, 'xp');
    assert.equal(allocated.npcTemplates.find(t => t.name === 'Human').progression.enabled, false);
    const creature = allocated.npcTemplates.find(t => t.name === 'Creature');
    assert.ok(creature.statIds.includes(creature.progression.xpFieldId));
    assert.ok(creature.statIds.includes(creature.progression.levelFieldId));
});

test('planner receives a dedicated schema and repair can correct the reported Gemma failure', async () => {
    const allocated = allocatePlan(plan); const requests = [];
    const run = new SystemGenerationRun({ premise: 'Basic Pokemon adventure', request: args => {
        requests.push(args);
        if (requests.length === 1) return '```json\n' + JSON.stringify({ section: gemmaPlan(), assumptions: [] }) + '\n```';
        return responseFor(args.stage, allocated);
    } });
    const result = await run.generate();
    assert.equal(requests.filter(r => r.stage === 'plan').length, 2);
    assert.ok(!Object.hasOwn(requests[0].schema.properties.section.properties, 'defaultValue'));
    assert.match(requests[0].schema.properties.section.properties.playerProgression.properties.xp.description, /NAME/);
    // Full-definition capacity examples must not compete with the planner's name contract.
    assert.equal(requests[0].systemPrompt.includes('0/100'), false);
    assert.equal(requests[1].systemPrompt.includes('0/100'), false);
    const repair = JSON.parse(requests[1].userPrompt).repair;
    assert.ok(repair.errors.some(message => message.includes('stats.npc')));
    assert.equal(result.definition.progression.player.enabled, true);
    assert.ok(result.assumptions.some(text => text.startsWith('Planning the rules was repaired')));
    assert.ok(requests.find(r => r.stage === 'stats.player').systemPrompt.includes('0/100'));
});
