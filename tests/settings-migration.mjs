import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { NPC_LORE_FIELDS } from '../src/core/constants-profile.js';

// Load the migration with its SillyTavern boundaries replaced by small fixtures.
const source = readFileSync(new URL('../src/core/settings-migration.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export function ', 'function ');
const loadMigration = new Function('debugLog', 'SPEAKER_PALETTE', 'NPC_LORE_FIELDS',
    'paletteIndexFor', 'normaliseNpcPersistence', 'defaultSettings', 'saveSettings',
    'migratePresetsAndStores', 'normaliseBaseSettings',
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
        () => {});
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
