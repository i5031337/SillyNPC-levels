import { normalizeTrackerProgression } from '../src/core/progression-config.js';
import { ensureCollectionIdentifier, ensureCollectionQuantity } from '../src/core/collection-fields.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { NPC_LORE_FIELDS } from '../src/core/constants-profile.js';
import { normaliseStatUpdatePolicies } from '../src/tracker/stat-update-policy.js';
import { migratePresetsAndStores } from '../src/core/settings-store-migration.js';
import { normalizeHudLayoutId } from '../src/core/constants-base.js';
import { normalizeCharacterPresentation } from '../src/core/npc-presentation.js';

// Load the migration with its SillyTavern boundaries replaced by small fixtures.
const source = readFileSync(new URL('../src/core/settings-migration.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export function ', 'function ');
const loadMigration = new Function('debugLog', 'SPEAKER_PALETTE', 'NPC_LORE_FIELDS',
    'paletteIndexFor', 'normaliseNpcPersistence', 'defaultSettings', 'saveSettings',
    'migratePresetsAndStores', 'normaliseBaseSettings', 'normaliseStatUpdatePolicies',
    'normalizeHudLayoutId', 'ensureCollectionIdentifier', 'ensureCollectionQuantity', 'normalizeTrackerProgression', 'normalizeCharacterPresentation',
    `${source}\nreturn normalizeSettings;`);

function migration() {
    const saves = [];
    const defaults = {
        version: '1.0.0',
        statusTracker: {
            globalStats: [], npcStats: [], playerStats: [], collections: [], hud: {},
        },
    };
    const normalize = loadMigration(() => {}, ['#111111', '#222222'],
        NPC_LORE_FIELDS, () => 0, () => {}, defaults,
        () => saves.push('saved'),
        (settings, version) => { settings.version = version; },
        () => {}, normaliseStatUpdatePolicies, normalizeHudLayoutId, ensureCollectionIdentifier, ensureCollectionQuantity, normalizeTrackerProgression,
        normalizeCharacterPresentation);
    return { normalize, saves };
}

test('imports repair character data and retain a single default portrait on repeated passes', () => {
    const { normalize } = migration();
    const settings = {
        version: '0.4.0',
        characters: [{ name: 'Mira', imageUrl: 'portrait.png', category: 'Crew' }],
        defaultImage: 'fallback.png',
        systemWorldArchive: { 'Old System': { characters: [{ name: 'Archived' }] } },
        statusTracker: { playerStats: [], collections: [] },
    };
    normalize(settings);
    normalize(settings);
    assert.deepEqual(settings.characters[0].images, ['portrait.png']);
    assert.deepEqual(settings.characters[0].aliases, []);
    assert.equal(settings.characters[0].presentation.expressions.enabled, false);
    assert.equal(settings.characters[0].profile.age, '');
    assert.equal(settings.characters[0].profile.history, '');
    assert.deepEqual(settings.categories, ['Crew']);
    assert.deepEqual(settings.defaultImages, [{ src: 'fallback.png', tags: [] }]);
    assert.equal('systemWorldArchive' in settings, false);
});

test('old HUD visibility migration runs once, preserving later choices', () => {
    const { normalize } = migration();
    const stat = { name: 'Health', isPrimary: true, visible: false };
    const settings = { version: '0.5.1', characters: [], statusTracker: {
        playerStats: [stat], collections: [],
    } };
    normalize(settings);
    assert.equal(stat.isPrimary, false);
    stat.isPrimary = true;
    normalize(settings);
    assert.equal(stat.isPrimary, true);
});

test('old NPC stat definitions migrate before defaults are filled', () => {
    const { normalize } = migration();
    const stats = [{ name: 'Trust', type: 'bar' }];
    const settings = { characters: [], statusTracker: { characterStats: stats } };
    normalize(settings);
    assert.equal(settings.statusTracker.npcStats, stats);
    assert.equal(stats[0].type, 'number');
    assert.equal(stats[0].visible, true);
    assert.equal('characterStats' in settings.statusTracker, false);
    normalize(settings);
    assert.equal(settings.statusTracker.npcStats, stats);
});

test('current NPC definitions win when an export also carries the old key', () => {
    const { normalize } = migration();
    const stats = [{ name: 'Trust', type: 'text' }];
    const settings = { characters: [], statusTracker: {
        npcStats: stats, characterStats: [{ name: 'Retired' }],
    } };
    normalize(settings);
    assert.equal(settings.statusTracker.npcStats, stats);
    assert.equal('characterStats' in settings.statusTracker, false);
});

test('old raw prompt overrides are dropped while other settings normalize', () => {
    const baseSource = readFileSync(new URL('../src/core/settings-base-migration.js', import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replace('export function normaliseBaseSettings', 'function normaliseBaseSettings');
    const normalizeBase = new Function('PORTRAIT_SHAPES', 'DEFAULT_PORTRAIT_SHAPE',
        'defaultSettings', 'resolveImageFolder', 'saveSettings',
        `${baseSource}\nreturn normaliseBaseSettings;`)(
            { square: {} }, 'square',
            { loreCharBudget: 100, loreMaxTokens: 100, imgGenPromptPrefix: 'Solo, profile picture' },
            value => value, () => {},
        );
    const settings = { statusTracker: { extractionPrompt: 'custom', systemRules: 'custom' },
        dialogueFormatPrompt: 'custom', narratorRulesPrompt: 'custom',
        generationPrompt: 'custom', imgGenPrompt: 'custom', imgGenNegativePrompt: 'custom',
        promptTexts: { reader: 'custom' }, imageBackend: 'gemini', imgGenContextMessages: 10 };

    normalizeBase(settings);

    for (const key of ['dialogueFormatPrompt', 'narratorRulesPrompt', 'generationPrompt',
        'imgGenPrompt', 'imgGenNegativePrompt', 'imgGenContextMessages', 'promptTexts', 'imageBackend']) {
        assert.equal(key in settings, false);
    }
    assert.equal('extractionPrompt' in settings.statusTracker, false);
    assert.equal('systemRules' in settings.statusTracker, false);
});

test('legacy profile hints enter old System presets before the flat setting is removed', () => {
    const settings = { statusTracker: { presets: { old: { playerStats: [] } } },
        profileHints: { appearance: 'Describe distinguishing features' } };
    migratePresetsAndStores(settings, '1.0.0');
    assert.equal(settings.statusTracker.presets.old.config.profileHints.appearance,
        'Describe distinguishing features');
    assert.equal('profileHints' in settings, false);
});

test('collection identifiers normalize on startup while retaining existing item identities', () => {
    const { normalize } = migration();
    const settings = { characters: [], statusTracker: { playerStats: [], collections: [
        { id: 'moves', fields: [{ name: 'pp' }, { name: 'move', isPrimary: true }] },
        { id: 'empty', fields: [] },
        { id: 'legacy', fields: ['quantity', 'name'] },
    ] } };
    normalize(settings);
    assert.equal(settings.statusTracker.collections[0].fields[0].name, 'move');
    assert.equal(settings.statusTracker.collections[1].fields[0].name, 'name');
    assert.equal(settings.statusTracker.collections[2].fields[0].name, 'name');
    for (const collection of settings.statusTracker.collections) {
        assert.equal(collection.fields.filter(field => field.isPrimary).length, 1);
    }
});

test('progression migration assigns IDs and retains saved narrative bonuses without creating new ones', () => {
    const { normalize } = migration();
    const settings = { version: '1.0.0', characters: [], statusTracker: {
        playerStats: [{ name: 'XP', type: 'number', defaultValue: '0/10' },
            { name: 'Level', type: 'number', defaultValue: '1' }], npcStats: [], collections: [],
    } };
    normalize(settings);
    assert.equal(settings.statusTracker.playerStats.length, 2);
    assert.equal(settings.statusTracker.progression.player.xpFieldId, 'xp');
    assert.equal(settings.statusTracker.progression.player.enabled, true);
    settings.statusTracker.playerStats.push({ name: 'Level Bonus', defaultValue: 'Saved narrative' });
    normalize(settings);
    assert.equal(settings.statusTracker.playerStats.at(-1).defaultValue, 'Saved narrative');
});
