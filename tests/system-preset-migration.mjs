import { normalizeTrackerProgression } from '../src/core/progression-config.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeSystemDefinition } from '../src/core/system-schema.js';

const settings = {
    activeSystem: 'Harbor RPG', characters: [{ id: 'live', name: 'Live' }],
    personaData: { 'Rhea.png': { stats: { XP: '3/10' } } }, master_items: {},
    statusTracker: { globalStats: [], playerStats: [], npcStats: [], collections: [], presets: {} },
};
let saves = 0;
const deps = {};
function loadBind(file, names, values) {
    const source = readFileSync(new URL(`../src/tracker/${file}`, import.meta.url), 'utf8')
        .replace(/^import[\s\S]*?;\s*/gm, '')
        .replace('export function bind(deps)', 'function bind(deps)');
    return new Function(...names, `${source}\nreturn bind;`)(...values);
}
const bindPresets = loadBind('status-system-presets.js', [
    'getSettings', 'saveSettings', 'defaultSettings', 'normaliseStatDefs',
    'normaliseNpcPersistence', 'normaliseStatUpdatePolicies', 'normalizeSystemDefinition',
    'debugLog', 'normalizeTrackerProgression',
], [() => settings, () => { saves++; }, { statusTracker: {}, characters: [], personaData: {}, master_items: {} },
    () => {}, () => {}, () => {}, normalizeSystemDefinition, () => {}, normalizeTrackerProgression]);
bindPresets(deps);

test('System switches and creation preserve the user menu text size', () => {
    settings.menuFontScale = 1.1;
    const config = { menuFontScale: 1, statusTracker: {
        globalStats: [], playerStats: [], npcStats: [], collections: [],
    } };
    deps.applySystemPreset({ config });
    assert.equal(settings.menuFontScale, 1.1);
    deps.saveSystemPreset('Text Size Fixture');
    assert.equal(settings.statusTracker.presets['Text Size Fixture'].config.menuFontScale, undefined);
    deps.chatHasStarted = () => false;
    assert.equal(deps.createSystem('Text Size New System'), true);
    assert.equal(settings.menuFontScale, 1.1);
    delete settings.statusTracker.presets['Text Size Fixture'];
    delete settings.statusTracker.presets['Text Size New System'];
    settings.activeSystem = 'Harbor RPG';
});

test('loaded legacy world is discarded and stays outside the System', () => {
    settings.statusTracker.presets['Harbor RPG'] = {
        version: '2.1.0', metadata: { name: 'Harbor RPG', author: 'User' },
        config: { statusTracker: { globalStats: [{ name: 'Location', type: 'bar' }], playerStats: [], npcStats: [], collections: [] } },
        world: { characters: [{ id: 'old', name: 'Mira' }], personaData: { 'Rhea.png': { stats: { XP: '3/10' } } }, master_items: { inventory: {} } },
    };
    deps.migrateToActiveSystem();
    assert.equal(settings.characters[0].name, 'Live');
    assert.equal(settings.statusTracker.presets['Harbor RPG'].world, undefined);
    assert.equal(settings.statusTracker.presets['Harbor RPG'].definition.stats.world[0].type, 'number');
    deps.saveSystemPreset('Harbor RPG');
    const saved = settings.statusTracker.presets['Harbor RPG'];
    assert.equal(saved.world, undefined);
    assert.equal(JSON.stringify(saved).includes('Mira'), false);
    assert.equal(JSON.stringify(saved.definition).includes('Rhea.png'), false);
    assert.equal(settings.characters[0].name, 'Live');
});

test('old profile import ignores its world; modern definition import is usable', () => {
    const old = {
        metadata: { name: 'Old Import' }, config: {
            globalStats: [{ name: 'Time' }], characters: [{ name: 'Embedded' }],
            systemWorldArchive: { old: {} },
        },
        world: { characters: [{ name: 'Legacy' }], personaData: {}, master_items: {} },
    };
    deps.importSystemPreset(JSON.stringify(old));
    assert.equal(settings.statusTracker.presets['Old Import'].world, undefined);
    assert.equal(settings.statusTracker.presets['Old Import'].config.characters, undefined);
    assert.equal(settings.statusTracker.presets['Old Import'].config.systemWorldArchive, undefined);
    const duplicate = deps.importSystemPreset(JSON.stringify(old));
    assert.equal(duplicate.metadata.name, 'Old Import (2)');
    assert.equal(duplicate.world, undefined);

    const modern = normalizeSystemDefinition({ schemaVersion: 1, name: 'Sci-Fi',
        profiles: { player: [], npc: [{ id: 'call-sign', label: 'Call sign', policy: 'anchored' }] },
        stats: { world: [{ id: 'ship', name: 'Ship', defaultValue: 'Port' }], player: [], npc: [] },
        collections: [],
    });
    const imported = deps.importSystemPreset(JSON.stringify(modern));
    assert.equal(imported.definition.name, 'Sci-Fi');
    assert.equal(imported.config.statusTracker.globalStats[0].name, 'Ship');
    deps.saveSystemPreset('Sci-Fi');
    assert.equal(settings.statusTracker.presets['Sci-Fi'].definition.profiles.npc[0].id, 'call-sign');
    deps.chatHasStarted = () => true;
    deps.getChatSystem = () => 'Harbor RPG';
    assert.equal(deps.setActiveSystem('Sci-Fi'), false);
    assert.equal(deps.createSystem('Fantasy'), false);
    assert.equal(settings.activeSystem, 'Harbor RPG');
    let reassigned = 0;
    let reset = 0;
    deps.chatHasStarted = () => false;
    deps.hasOpenChat = () => true;
    deps.resetUnplayedChatState = () => { reset++; };
    deps.rememberChatSystem = () => { reassigned++; };
    assert.equal(deps.setActiveSystem('Sci-Fi'), true);
    assert.equal(reassigned, 1);
    assert.equal(reset, 1);
    assert.equal(settings.activeSystem, 'Sci-Fi');
    deps.applySystemPreset({ config: { statusTracker: { globalStats: [], playerStats: [], npcStats: [], collections: [] } },
        world: { characters: [{ name: 'Legacy NPC' }], personaData: {}, master_items: {} } });
    assert.equal(settings.characters[0].name, 'Live');
    assert.ok(saves > 0);
});

test('template definitions survive System capture and modern import', () => {
    const system = normalizeSystemDefinition({ schemaVersion: 1, name: 'Mixed Cast',
        profiles: { player: [], npc: [{ id: 'species', label: 'Species' }] },
        stats: { world: [], player: [], npc: [{ id: 'hp', name: 'HP' }] },
        npcTemplates: [{ id: 'pokemon', name: 'Pokémon', description: 'Pokémon creatures.',
            profileIds: ['species'], statIds: ['hp'] }],
    });
    deps.importSystemPreset(JSON.stringify(system));
    settings.statusTracker.npcStats = structuredClone(system.stats.npc);
    deps.saveSystemPreset('Mixed Cast');
    assert.deepEqual(settings.statusTracker.presets['Mixed Cast'].definition.npcTemplates, system.npcTemplates);
    assert.equal(settings.statusTracker.presets['Mixed Cast'].definition.legacyNpcTemplateId, undefined);
    deps.chatHasStarted = () => false;
    assert.equal(deps.createSystem('New Empty System'), true);
    assert.deepEqual(settings.statusTracker.presets['New Empty System'].definition.npcTemplates, []);
    assert.equal(settings.statusTracker.presets['New Empty System'].definition.legacyNpcTemplateId, undefined);
});

test('canonical progression projects into live tracker and survives capture', () => {
    const definition = normalizeSystemDefinition({ schemaVersion: 1, name: 'Growth',
        stats: { world: [], npc: [
            { id: 'xp', name: 'NPC Experience', defaultValue: '0/10' },
            { id: 'level', name: 'NPC Rank', defaultValue: '1' },
        ], player: [
            { id: 'earned', name: 'Experience', defaultValue: '0/10' },
            { id: 'rank', name: 'Rank', defaultValue: '1' },
        ] },
        progression: { player: { enabled: true, xpFieldId: 'earned', levelFieldId: 'rank', pointsPerLevel: 0, assignment: 'random' } },
        npcTemplates: [{ id: 'human', name: 'Human', statIds: ['xp', 'level'],
            progression: { enabled: true, xpFieldId: 'xp', levelFieldId: 'level', pointsPerLevel: 0, assignment: 'random' } }],
    });
    const imported = deps.migratePreset('Growth', { definition, metadata: { name: 'Growth' } });
    deps.applySystemPreset(imported);
    assert.equal(settings.statusTracker.playerStats[0].id, 'earned');
    assert.equal(settings.statusTracker.progression.player.xpFieldId, 'earned');
    assert.equal(settings.statusTracker.npcTemplates[0].progression.enabled, true);
    settings.statusTracker.presets.Growth = imported;
    deps.saveSystemPreset('Growth');
    assert.equal(settings.statusTracker.presets.Growth.definition.progression.player.xpFieldId, 'earned');
});

test('generated fixture imports without activation and retains rules through capture/export', () => {
    const definition = JSON.parse(readFileSync(new URL('./fixtures/generated-expedition-system.json', import.meta.url), 'utf8'));
    const before = structuredClone(settings);
    const savedCount = saves;
    const imported = deps.importSystemPreset(JSON.stringify(definition));
    const after = structuredClone(settings);
    delete before.statusTracker.presets; delete after.statusTracker.presets;
    assert.deepEqual(after, before);
    assert.equal(saves, savedCount + 1);
    assert.deepEqual(imported.definition, definition);
    assert.equal(imported.config.statusTracker.collections[0].hint, definition.collections[0].guidance);
    deps.applySystemPreset(imported);
    deps.saveSystemPreset(definition.name, definition.metadata.description, definition.metadata.author);
    const captured = settings.statusTracker.presets[definition.name].definition;
    assert.deepEqual(captured.hud.playerStatIds, ['energy']);
    assert.deepEqual(captured.progression, definition.progression);
    assert.deepEqual(captured.npcTemplates, definition.npcTemplates);
    assert.deepEqual(captured.collections, definition.collections);
    assert.deepEqual(captured.stats, definition.stats);
});
