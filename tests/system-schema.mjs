import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSystemDefinition, getSystemField, SYSTEM_SCHEMA_VERSION } from '../src/core/system-schema.js';

test('legacy preset migration keeps only reusable schema and stable generated IDs', () => {
    const preset = {
        metadata: { name: 'Space Opera', author: 'Test' },
        config: {
            profileHints: { appearance: 'Describe visible details.' },
            statusTracker: {
                globalStats: [{ name: 'Ship Location', defaultValue: 'Dock' }],
                playerStats: [{ name: 'XP', defaultValue: '0/100' }, { name: 'Level', defaultValue: '1' }],
                npcStats: [{ name: 'Trust', defaultValue: '0' }],
                collections: [{ id: 'cargo', name: 'Cargo', target: 'all', fields: [
                    { name: 'name', type: 'text', isPrimary: true },
                    { name: 'quantity', type: 'number' },
                ] }],
            },
            characters: [{ name: 'Mira' }],
            personaData: { p: { profile: { age: '42' } } },
        },
        world: { characters: [{ name: 'Mira' }], master_items: { rare: true } },
    };
    const result = normalizeSystemDefinition(preset);
    assert.equal(result.schemaVersion, SYSTEM_SCHEMA_VERSION);
    assert.equal(result.id, 'space-opera');
    assert.equal(result.stats.world[0].id, 'ship-location');
    assert.equal(result.progression.player.enabled, true);
    assert.equal(result.progression.npc.enabled, false);
    assert.equal(result.profiles.npc.find(field => field.id === 'appearance').guidance, 'Describe visible details.');
    assert.equal(result.collections[0].fields[1].isStatic, false);
    assert.equal(result.collections[0].includeInImagePrompt, true);
    assert.equal(result.memories.maxEntriesPerCharacter, 50);
    assert.equal(JSON.stringify(result).includes('Mira'), false);
    assert.equal(JSON.stringify(result).includes('rare'), false);
    assert.deepEqual(normalizeSystemDefinition(result), result);
});

test('System definitions retain collection image prompt choices', () => {
    const system = normalizeSystemDefinition({ schemaVersion: SYSTEM_SCHEMA_VERSION,
        collections: [{ id: 'secrets', includeInImagePrompt: false, fields: [] }],
    });
    assert.equal(system.collections[0].includeInImagePrompt, false);
    assert.deepEqual(normalizeSystemDefinition(system), system);
});

test('player and NPC profiles differ and label edits preserve field IDs', () => {
    const system = normalizeSystemDefinition({});
    assert.equal(getSystemField(system, 'player', 'profile', 'role'), null);
    assert.equal(getSystemField(system, 'npc', 'profile', 'role').label, 'Role');
    assert.equal(getSystemField(system, 'npc', 'profile', 'appearance').policy, 'anchored');
    assert.equal(getSystemField(system, 'npc', 'profile', 'history').policy, 'replaceable');
    system.profiles.npc.find(field => field.id === 'role').label = 'Occupation';
    assert.equal(getSystemField(normalizeSystemDefinition(system), 'npc', 'profile', 'role').label, 'Occupation');
});

test('modern definitions bound memory limits and retain configured fields and policies', () => {
    const system = normalizeSystemDefinition({
        schemaVersion: 1, name: 'Romance',
        profiles: { player: [{ id: 'goal', label: 'Long-term goal', policy: 'replaceable' }],
            npc: [{ id: 'memories', label: 'Memories', policy: 'memory' }] },
        stats: { player: [], npc: [], world: [] }, collections: [],
        memories: { maxEntriesPerCharacter: 9000 },
    });
    assert.equal(system.memories.maxEntriesPerCharacter, 50);
    assert.equal(system.profiles.npc[0].policy, 'memory');
    assert.equal(system.profiles.player[0].id, 'goal');
    assert.deepEqual(system.stats.player, []);
});

test('duplicate legacy names receive distinct IDs without mutating input', () => {
    const source = { config: { playerStats: [
        { name: 'Willpower / Focus', defaultValue: '1' },
        { name: 'Willpower Focus', defaultValue: '2' },
    ] } };
    const before = structuredClone(source);
    const system = normalizeSystemDefinition(source);
    assert.deepEqual(system.stats.player.map(field => field.id), ['willpower-focus', 'willpower-focus-2']);
    assert.deepEqual(source, before);
});
