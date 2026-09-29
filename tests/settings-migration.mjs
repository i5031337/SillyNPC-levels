import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { NPC_LORE_FIELDS } from '../src/core/constants-profile.js';
import { normaliseStatUpdatePolicies } from '../src/tracker/stat-update-policy.js';
import { migratePresetsAndStores } from '../src/core/settings-store-migration.js';
import { normalizeHudLayoutId } from '../src/core/constants-base.js';

// Load the migration with its SillyTavern boundaries replaced by small fixtures.
const source = readFileSync(new URL('../src/core/settings-migration.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export function ', 'function ');
const loadMigration = new Function('debugLog', 'SPEAKER_PALETTE', 'NPC_LORE_FIELDS',
    'paletteIndexFor', 'normaliseNpcPersistence', 'defaultSettings', 'saveSettings',
    'migratePresetsAndStores', 'normaliseBaseSettings', 'normaliseStatUpdatePolicies',
    'normalizeHudLayoutId',
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
        () => {}, normaliseStatUpdatePolicies, normalizeHudLayoutId);
    return { normalize, saves };
}

test('imports repair character data and retain a single default portrait on repeated passes', () => {
    const { normalize } = migration();
    const settings = {
        version: '0.4.0',
        characters: [{ name: 'Mira', imageUrl: 'portrait.png', category: 'Crew' }],
        defaultImage: 'fallback.png',
        statusTracker: { playerStats: [], collections: [] },
    };
    normalize(settings);
    normalize(settings);
    assert.deepEqual(settings.characters[0].images, ['portrait.png']);
    assert.deepEqual(settings.characters[0].aliases, []);
    assert.equal(settings.characters[0].profile.age, '');
    assert.equal(settings.characters[0].profile.history, '');
    assert.deepEqual(settings.categories, ['Crew']);
    assert.deepEqual(settings.defaultImages, [{ src: 'fallback.png', tags: [] }]);
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

test('old raw prompt overrides are dropped while other settings normalize', () => {
    const baseSource = readFileSync(new URL('../src/core/settings-base-migration.js', import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replace('export function normaliseBaseSettings', 'function normaliseBaseSettings');
    const normalizeBase = new Function('PORTRAIT_SHAPES', 'DEFAULT_PORTRAIT_SHAPE',
        'defaultSettings', 'resolveImageFolder', 'saveSettings',
        `${baseSource}\nreturn normaliseBaseSettings;`)(
            { square: {} }, 'square',
            { loreCharBudget: 100, loreMaxTokens: 100, imgGenContextMessages: 0 },
            value => value, () => {},
        );
    const settings = { statusTracker: { extractionPrompt: 'custom', systemRules: 'custom' },
        dialogueFormatPrompt: 'custom', narratorRulesPrompt: 'custom',
        generationPrompt: 'custom', imgGenPrompt: 'custom', imgGenNegativePrompt: 'custom',
        promptTexts: { reader: 'custom' }, imageBackend: 'gemini' };

    normalizeBase(settings);

    for (const key of ['dialogueFormatPrompt', 'narratorRulesPrompt', 'generationPrompt',
        'imgGenPrompt', 'imgGenNegativePrompt', 'promptTexts', 'imageBackend']) {
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
