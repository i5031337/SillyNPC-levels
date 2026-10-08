import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProgressionConfig, resolveProgressionConfig } from '../src/core/progression-config.js';
import { normalizeSystemDefinition } from '../src/core/system-schema.js';
const stats = [
    { id: 'experience', name: 'XP', defaultValue: '0/100' },
    { id: 'rank', name: 'Level', defaultValue: '1' },
    { id: 'hp', name: 'Health', type: 'number', advanceOnLevel: true },
    { id: 'locked', name: 'Locked', type: 'number', locked: true },
];
test('canonical config migrates old candidates, validates growth, and respects field IDs', () => {
    const config = normalizeProgressionConfig({}, stats, { enabledByDefault: true });
    assert.equal(config.enabled, true);
    assert.equal(config.pointsPerLevel, 1);
    assert.equal(config.assignment, 'random');
    assert.deepEqual(config.statIds, ['hp']);
    const renamed = stats.map(stat => ({ ...stat, name: `Renamed ${stat.id}` }));
    const edited = normalizeProgressionConfig({ ...config, pointsPerLevel: 2, assignment: 'random', statIds: ['hp', 'locked', 'rank'], increments: { hp: 3 } }, renamed);
    assert.equal(edited.enabled, true);
    assert.deepEqual(edited.statIds, ['hp', 'locked']);
    assert.equal(edited.increments, undefined);
});
test('NPC templates opt in independently and only select owned fields', () => {
    const tracker = { npcStats: stats, npcTemplates: [
        { id: 'disabled', statIds: stats.map(stat => stat.id) },
        { id: 'enabled', statIds: ['experience', 'rank', 'hp'], progression: { enabled: true, pointsPerLevel: 2, assignment: 'random', statIds: ['hp'] } },
    ] };
    assert.equal(resolveProgressionConfig(tracker, { templateId: 'disabled' }).enabled, false);
    assert.equal(resolveProgressionConfig(tracker, { templateId: 'enabled' }).enabled, true);
    assert.equal(resolveProgressionConfig(tracker, { templateId: 'unknown' }).enabled, false);
});
test('progression config and template IDs survive System round trip', () => {
    const system = normalizeSystemDefinition({ schemaVersion: 1, stats: { player: stats, npc: stats, world: [] },
        npcTemplates: [{ id: 'hero', statIds: ['experience', 'rank', 'hp'], progression: { enabled: true, pointsPerLevel: 2, assignment: 'random', statIds: ['hp'], increments: { hp: 2 } } }],
        progression: { player: { enabled: true, xpFieldId: 'experience', levelFieldId: 'rank', pointsPerLevel: 0, assignment: 'random' } },
    });
    assert.deepEqual(normalizeSystemDefinition(system), system);
    assert.equal(system.npcTemplates[0].progression.enabled, true);
    assert.deepEqual(system.npcTemplates[0].progression.statIds, ['hp']);
    assert.equal(system.npcTemplates[0].progression.increments, undefined);
});

test('point budgets exceed candidate counts, preserve zero, and normalize invalid settings', () => {
    const source = { enabled: true, statIds: ['hp'], pointsPerLevel: 20, assignment: 'manual' };
    const config = normalizeProgressionConfig(source, stats);
    assert.equal(config.pointsPerLevel, 20);
    assert.equal(config.assignment, 'manual');
    assert.equal(normalizeProgressionConfig({ ...source, pointsPerLevel: 0 }, stats).pointsPerLevel, 0);
    assert.equal(normalizeProgressionConfig({ ...source, pointsPerLevel: -1 }, stats).pointsPerLevel, 1);
    assert.equal(normalizeProgressionConfig({ ...source, pointsPerLevel: 1.5 }, stats).pointsPerLevel, 1);
    assert.equal(normalizeProgressionConfig({ ...source, assignment: 'bad' }, stats).assignment, 'random');
    assert.equal(config.statGrowth, undefined);
    const oldNone = normalizeProgressionConfig({ enabled: true, statGrowth: 'none', statIds: ['hp'] }, stats);
    assert.equal(oldNone.pointsPerLevel, 0);
    assert.equal(oldNone.statGrowth, undefined);
});
