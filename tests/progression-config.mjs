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
    assert.equal(config.statGrowth, 'one');
    assert.deepEqual(config.statIds, ['hp']);
    const renamed = stats.map(stat => ({ ...stat, name: `Renamed ${stat.id}` }));
    const edited = normalizeProgressionConfig({ ...config, statGrowth: 'all', statIds: ['hp', 'locked', 'rank'], increments: { hp: 3 } }, renamed);
    assert.equal(edited.enabled, true);
    assert.deepEqual(edited.increments, { hp: 3 });
});
test('NPC templates opt in independently and only select owned fields', () => {
    const tracker = { npcStats: stats, npcTemplates: [
        { id: 'disabled', statIds: stats.map(stat => stat.id) },
        { id: 'enabled', statIds: ['experience', 'rank', 'hp'], progression: { enabled: true, statGrowth: 'all', statIds: ['hp'] } },
    ] };
    assert.equal(resolveProgressionConfig(tracker, { templateId: 'disabled' }).enabled, false);
    assert.equal(resolveProgressionConfig(tracker, { templateId: 'enabled' }).enabled, true);
    assert.equal(resolveProgressionConfig(tracker, { templateId: 'unknown' }).enabled, false);
});
test('progression config and template IDs survive System round trip', () => {
    const system = normalizeSystemDefinition({ schemaVersion: 1, stats: { player: stats, npc: stats, world: [] },
        npcTemplates: [{ id: 'hero', statIds: ['experience', 'rank', 'hp'], progression: { enabled: true, statGrowth: 'all', statIds: ['hp'], increments: { hp: 2 } } }],
        progression: { player: { enabled: true, xpFieldId: 'experience', levelFieldId: 'rank', statGrowth: 'none' } },
    });
    assert.deepEqual(normalizeSystemDefinition(system), system);
    assert.equal(system.npcTemplates[0].progression.enabled, true);
    assert.equal(system.npcTemplates[0].progression.increments.hp, 2);
});
