import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSystemDefinition } from '../src/core/system-schema.js';
import { normaliseStatUpdatePolicies, isReaderStat } from '../src/tracker/stat-update-policy.js';
import { carriesNpcStat } from '../src/tracker/stat-persistence.js';
import { constrainNumericStat } from '../src/tracker/numeric-stat-bounds.js';
import { materializeGrantRows } from '../src/tracker/level-grant-review.js';
import { statSchema, characterStatSchema } from '../src/generation/contracts.js';
import { GENERATION_INSTRUCTIONS } from '../src/generation/generate-system.js';
import { validateFields } from '../src/generation/validate-definition.js';

test('reader locking and NPC carryover are independent and survive System round trips', () => {
    const stats = [
        { id: 'rating', name: 'Rating', type: 'number', defaultValue: '2', locked: true, carryOver: false },
        { id: 'pool', name: 'Pool', type: 'number', defaultValue: '5/10', locked: false, carryOver: true },
    ];
    const system = normalizeSystemDefinition({ schemaVersion: 1, stats: { npc: stats }, profiles: {}, npcTemplates: [] });
    const fields = system.stats.character;
    assert.equal(isReaderStat(fields[0]), false);
    assert.equal(carriesNpcStat(fields[0]), false);
    assert.equal(isReaderStat(fields[1]), true);
    assert.equal(carriesNpcStat(fields[1]), true);
    assert.deepEqual(normalizeSystemDefinition(system), system);
});

test('legacy policies migrate once, preserving earned XP and explicit carryover choices', () => {
    const tracker = { npcStats: [
        { id: 'earned', name: 'Experience', updatePolicy: 'advancement' },
        { id: 'rank', name: 'Rank', updatePolicy: 'advancement', carryOver: false },
    ], npcTemplates: [{ progression: { xpFieldId: 'earned' } }] };
    normaliseStatUpdatePolicies(tracker);
    assert.equal(tracker.npcStats[0].locked, false);
    assert.equal(tracker.npcStats[0].carryOver, true);
    assert.equal(tracker.npcStats[1].locked, true);
    assert.equal(tracker.npcStats[1].carryOver, false);
    assert.equal(tracker.npcStats[1].updatePolicy, undefined);
    tracker.npcStats[1].locked = false;
    normaliseStatUpdatePolicies(tracker);
    assert.equal(tracker.npcStats[1].locked, false);
});

test('locked stats receive selected level growth, with pool capacity independent of locking', () => {
    const definitions = [
        { id: 'xp', name: 'XP', type: 'number', defaultValue: '0/10' },
        { id: 'level', name: 'Level', type: 'number', defaultValue: '1', locked: true },
        { id: 'rating', name: 'Rating', type: 'number', defaultValue: '2', maxStatValue: '5', locked: true },
        { id: 'pool', name: 'Pool', type: 'number', defaultValue: '5/10', locked: true },
    ];
    const settings = { playerStats: definitions, progression: { player: {
        enabled: true, xpFieldId: 'xp', levelFieldId: 'level', pointsPerLevel: 2, assignment: 'random', statIds: ['rating', 'pool'],
    } } };
    const state = { player: { stats: { XP: '0/10', Level: '2', Rating: '4', Pool: '5/10' } } };
    const rows = ['Rating', 'Pool'].map(label => ({ scope: 'player', kind: 'stat', label,
        grant: { id: label, gain: 2, statId: label.toLowerCase(), transitionId: 't',
            actorId: 'player:player', xpName: 'XP', levelName: 'Level', newLevel: 2 } }));
    const result = materializeGrantRows(rows, state, settings, [], { acceptedTransitionIds: ['t'] });
    assert.equal(result.rejected.length, 0);
    assert.equal(result.rows.find(row => row.label === 'Rating').grant.valueAfter, '5');
    assert.equal(result.rows.find(row => row.label === 'Pool').grant.valueAfter, '7/12');
    assert.equal(constrainNumericStat(definitions[2], '8', '4'), '5');
    assert.equal(constrainNumericStat(definitions[3], '11', '5/12'), '11');
});

test('premise generation and canonical stat schema expose the editor contract and format rules', () => {
    const field = { id: 'rating', name: 'Rating', type: 'number', defaultValue: '2',
        locked: true, carryOver: false, format: '{{name}}: {{value}}' };
    const canonical = normalizeSystemDefinition({ schemaVersion: 1, stats: { npc: [field] }, profiles: {}, npcTemplates: [] }).stats.character[0];
    assert.deepEqual(Object.keys(characterStatSchema.properties).sort(), Object.keys(canonical).sort());
    assert.ok(statSchema.required.includes('locked'));
    assert.equal(statSchema.properties.updatePolicy, undefined);
    assert.equal(statSchema.properties.persistence, undefined);
    assert.match(GENERATION_INSTRUCTIONS, /Locked stats remain eligible for level growth/);
    assert.deepEqual(statSchema.properties.format.enum, ['{{name}}: {{value}}', '{{value}}']);
    const errors = [];
    validateFields([field], 'stats.npc', errors);
    assert.deepEqual(errors, []);
    validateFields([{ ...field, format: '{{unsupported}}' }], 'stats.npc', errors);
    assert.ok(errors.some(error => error.includes('name and value or value only')));
});
