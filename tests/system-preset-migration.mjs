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
    'debugLog',
], [() => settings, () => { saves++; }, { statusTracker: {}, characters: [], personaData: {}, master_items: {} },
    () => {}, () => {}, () => {}, normalizeSystemDefinition, () => {}]);
bindPresets(deps);

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
