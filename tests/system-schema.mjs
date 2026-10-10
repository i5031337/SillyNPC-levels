import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSystemDefinition, getSystemField, SYSTEM_SCHEMA_VERSION } from '../src/core/system-schema.js';
import { systemStatFields, systemProfileFields, templateStatIds } from '../src/core/system-fields.js';
import { HUD_LAYOUTS, hudLayoutFor, normalizeHudLayoutId } from '../src/core/constants-base.js';

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
    assert.equal(result.npcTemplates[0].progression.enabled, false);
    assert.equal(systemProfileFields(result, 'npc').find(field => field.id === 'appearance').guidance, 'Describe visible details.');
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
    assert.ok(systemProfileFields(system, 'npc').every(field => !Object.hasOwn(field, 'policy')));
    systemProfileFields(system, 'npc').find(field => field.id === 'role').label = 'Occupation';
    assert.equal(getSystemField(normalizeSystemDefinition(system), 'npc', 'profile', 'role').label, 'Occupation');
});

test('modern definitions bound memory limits and retain configured fields', () => {
    const system = normalizeSystemDefinition({
        schemaVersion: 1, name: 'Romance',
        profiles: { player: [{ id: 'goal', label: 'Long-term goal' }],
            npc: [{ id: 'memories', label: 'Memories' }] },
        stats: { player: [], npc: [], world: [] }, collections: [],
        memories: { maxEntriesPerCharacter: 9000 },
    });
    assert.equal(system.memories.maxEntriesPerCharacter, 50);
    assert.equal(systemProfileFields(system, 'npc')[0].id, 'memories');
    assert.equal(systemProfileFields(system, 'player')[0].id, 'goal');
    assert.deepEqual(systemStatFields(system, 'player'), []);
});

test('stat purpose and numeric bounds survive system normalization', () => {
    const system = normalizeSystemDefinition({ config: { statusTracker: {
        globalStats: [], npcStats: [], collections: [],
        playerStats: [{ name: 'Focus', type: 'number', purpose: 'Spent on spells', min: '0',
            maxStatValue: '12', options: ['1', '2'], locked: true }],
    } } });
    const stat = systemStatFields(system, 'player')[0];
    assert.equal(stat.purpose, 'Spent on spells');
    assert.equal(stat.min, '0');
    assert.equal(stat.maxStatValue, '12');
    assert.deepEqual(stat.options, []);
    assert.equal(stat.locked, true);
    assert.deepEqual(normalizeSystemDefinition(system), system);
});

test('duplicate legacy names receive distinct IDs without mutating input', () => {
    const source = { config: { playerStats: [
        { name: 'Willpower / Focus', defaultValue: '1' },
        { name: 'Willpower Focus', defaultValue: '2' },
    ] } };
    const before = structuredClone(source);
    const system = normalizeSystemDefinition(source);
    assert.deepEqual(systemStatFields(system, 'player').map(field => field.id), ['willpower-focus', 'willpower-focus-2']);
    assert.deepEqual(source, before);
});

test('System normalization ignores removed goal switches while retaining profile objectives', () => {
    const input = { schemaVersion: SYSTEM_SCHEMA_VERSION, name: 'Objectives in profiles',
        profiles: [{ id: 'wants', label: 'Wants', targets: ['player'] }],
        goals: { npcShortTerm: true, playerShortTerm: true, playerLongTerm: true } };
    const normalized = normalizeSystemDefinition(input);
    assert.equal(Object.hasOwn(normalized, 'goals'), false);
    assert.equal(systemProfileFields(normalized, 'player')[0].id, 'wants');
    assert.equal(input.goals.playerLongTerm, true);
});


test('System memory capture is opt-in, independently configured, and bounded', () => {
    const defaults = normalizeSystemDefinition({}).memories;
    assert.deepEqual(defaults, { enabled: false, guidance: '', interval: 8, maxEntriesPerCharacter: 50 });
    const input = { schemaVersion: 1, profiles: { player: [], npc: [] },
        memories: { enabled: true, guidance: 'Remember clues personally discovered.', interval: 12, maxEntriesPerCharacter: 20 } };
    const normalized = normalizeSystemDefinition(input);
    assert.deepEqual(normalized.memories, input.memories);
    assert.deepEqual(normalizeSystemDefinition(normalized), normalized);
    for (const interval of [0, 101, 1.5, '8', null]) {
        assert.equal(normalizeSystemDefinition({ memories: { interval } }).memories.interval, 8);
    }
    assert.equal(normalizeSystemDefinition({ memories: { enabled: 'true', guidance: 'x'.repeat(4001) } }).memories.enabled, false);
    assert.equal(normalizeSystemDefinition({ memories: { guidance: 'x'.repeat(4001) } }).memories.guidance.length, 4000);
});

test('retired HUD layouts resolve to a supported style', () => {
    assert.deepEqual(HUD_LAYOUTS.map(layout => layout.id),
        ['plate', 'underline', 'pips', 'splitring']);
    for (const [oldId, currentId] of Object.entries({
        blades: 'plate', dock: 'plate', fan: 'underline', brackets: 'underline',
    })) {
        assert.equal(normalizeHudLayoutId(oldId), currentId);
        assert.equal(hudLayoutFor(oldId).id, currentId);
        assert.equal(normalizeSystemDefinition({ schemaVersion: 1, hud: { layout: oldId } })
            .hud.layout, currentId);
    }
    assert.equal(hudLayoutFor('unknown').id, 'plate');
});

 test('shared catalogs merge equivalent definitions and remap independent legacy references', () => {
    const source = { schemaVersion: 1, profiles: { player: [{id:'bio',label:'Bio'}], npc:[{id:'bio',label:'Species'}] },
        stats: { world: [], player: [{id:'hp',name:'HP',type:'number',defaultValue:'10'}, {id:'xp',name:'XP',defaultValue:'0/10'}, {id:'level',name:'Level',defaultValue:'1'}],
            npc: [{id:'hp',name:'HP',type:'number',defaultValue:'10'}, {id:'xp',name:'XP',defaultValue:'0/20'}, {id:'level',name:'Level',defaultValue:'1'}] },
        npcTemplates:[{id:'human',name:'Human',profileIds:['bio'],statIds:['hp','xp','level'],progression:{enabled:true,xpFieldId:'xp',levelFieldId:'level'}}],
        hud:{npcStatIds:['hp','xp']} };
    const system = normalizeSystemDefinition(source);
    assert.equal(system.stats.character.length,4);
    assert.deepEqual(system.stats.character.find(field=>field.id==='hp').targets,['player','template:human']);
    assert.equal(system.npcTemplates[0].progression.xpFieldId,'xp-2');
    assert.equal(system.npcTemplates[0].progression.enabled,true);
    assert.deepEqual(templateStatIds(system,system.npcTemplates[0]),['hp','level','xp-2']);
    assert.deepEqual(system.hud.npcStatIds,['hp','xp-2']);
    assert.equal(system.profiles[1].legacyId,'bio');
    assert.equal(Object.hasOwn(system.npcTemplates[0],'statIds'),false);
    assert.deepEqual(normalizeSystemDefinition(system),system);
});

test('stat display normalization keeps only show-name and value-only formats', () => {
    for (const [format, expected] of [
        ['<b>{{name}}</b> — {{value}} kg', '{{name}}: {{value}}'],
        ['❤️ {{value}} of {{max}}', '{{value}}'],
        ['{{value}}', '{{value}}'],
        [undefined, '{{name}}: {{value}}'],
    ]) {
        const definition = normalizeSystemDefinition({ schemaVersion: 2,
            stats: { character: [{ id: 'health', name: 'Health', format, targets: ['player'] }] } });
        assert.equal(definition.stats.character[0].format, expected);
        assert.deepEqual(normalizeSystemDefinition(definition), definition);
    }
});

test('shared assignments apply to player, every NPC, or a specific template', () => {
    const system = normalizeSystemDefinition({schemaVersion:2,stats:{world:[],character:[
        {id:'hp',name:'HP',targets:['player','npc']}, {id:'mana',name:'Mana',targets:['template:mage']}]},
        profiles:[{id:'species',targets:['npc']}],npcTemplates:[{id:'mage',name:'Mage'}]});
    assert.deepEqual(systemStatFields(system,'player').map(field=>field.id),['hp']);
    assert.deepEqual(systemStatFields(system,'npc',{}).map(field=>field.id),['hp']);
    assert.deepEqual(systemStatFields(system,'npc',{npcTemplateId:'mage'}).map(field=>field.id),['hp','mana']);
    assert.deepEqual(systemStatFields(system,'npc').map(field=>field.id),['hp','mana']);
    assert.deepEqual(systemProfileFields(system,'npc',{}).map(field=>field.id),['species']);
});
