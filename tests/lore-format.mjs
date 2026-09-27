import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PROFILE_FIELDS, NPC_LORE_FIELDS, anyProfileFieldUnlocked } from '../src/core/constants-profile.js';
import { formatLoreContent, parseLoreContent, mergeLoreValues } from '../src/lore/lore-format.js';
import { defaultSettings } from '../src/core/settings-defaults.js';

test('every NPC lore field has one ordered line and round trips', () => {
    const values = { age: '34', role: 'Watchmaker', history: 'Moved here last spring.' };
    const content = formatLoreContent(values);
    assert.equal(content.split('\n').length, NPC_LORE_FIELDS.length);
    assert.deepEqual(parseLoreContent(`### Mira\n${content}`), {
        ...Object.fromEntries(NPC_LORE_FIELDS.map(field => [field.id, ''])), ...values,
    });
    assert.equal(mergeLoreValues(content, { role: 'Master watchmaker' }).role, 'Master watchmaker');
});

test('malformed or free-form NPC lore is rejected', () => {
    assert.equal(parseLoreContent('Role: Watchmaker\nHistory: Moved here.'), null);
    assert.equal(parseLoreContent(`${formatLoreContent({})}\nExtra: prose`), null);
    assert.equal(parseLoreContent(formatLoreContent({}).replace('Age:', 'Years:')), null);
});

test('the default Fill prompt names the complete field order', () => {
    const prompt = defaultSettings.generationPrompt;
    const format = prompt.slice(prompt.lastIndexOf('Content:\n') + 'Content:\n'.length);
    const labels = format.split('\n').map(line => line.slice(0, line.indexOf(':')));
    assert.deepEqual(labels, NPC_LORE_FIELDS.map(field => field.label));
    for (const field of NPC_LORE_FIELDS) {
        assert.ok(prompt.includes(`- ${field.label}: ${field.hint}`));
    }
});

test('tracker schema offers NPC lore fields without adding them to the player', () => {
    const source = readFileSync(new URL('../src/tracker/extractor/status-extractor-schema.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replaceAll('export function ', 'function ');
    const npc = { name: 'Mira', aiProfileFields: ['role'] };
    const player = { name: 'Hero', isPlayer: true, aiProfileFields: ['age'] };
    const build = new Function('getAllCharacters', 'getPlayerCard', 'PROFILE_FIELDS',
        'NPC_LORE_FIELDS', 'anyProfileFieldUnlocked',
        `${source}\nreturn buildExtractionSchema;`)(
        () => [npc], () => player, PROFILE_FIELDS, NPC_LORE_FIELDS, anyProfileFieldUnlocked,
    );
    const schema = build({ globalStats: [], playerStats: [], npcStats: [], collections: [] });
    assert.ok(schema.properties.characters.items.properties.profile.properties.role);
    assert.equal(schema.properties.player.properties.profile.properties.role, undefined);
});

test('Fill requests missing named fields in one generation call', async () => {
    const source = readFileSync(new URL('../src/characters/character-fill-lore.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replaceAll('export async function ', 'async function ');
    let calls = 0;
    const entry = formatLoreContent({ role: 'Watchmaker' });
    const fillLore = new Function('loadWorldInfo', 'debugLog', 'getSettings', 'saveSettings',
        'createLoreEntry', 'generateLoreContent', 'saveLoreContent',
        'tryAutoSyncLorebook', 'getChatLorebookName', 'NPC_LORE_FIELDS', 'parseLoreContent',
        `${source}\nreturn fillLore;`)(
        async () => ({ entries: { 0: { content: entry } } }),
        () => {}, () => ({ defaultLorebook: 'World' }), () => {},
        () => { throw new Error('should reuse linked entry'); },
        async () => { calls++; return { content: formatLoreContent({ age: '34', role: 'Watchmaker' }), tags: '' }; },
        async () => {}, () => false, () => 'World', NPC_LORE_FIELDS, parseLoreContent,
    );
    const char = { name: 'Mira', profile: {}, lorebook: { world: 'World', uid: 0 } };
    assert.equal((await fillLore(char)).ok, true);
    assert.equal(calls, 1);
});
