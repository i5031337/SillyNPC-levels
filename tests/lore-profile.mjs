import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { joinLoreProfile, mergeLoreProfile, splitLoreProfile } from '../src/lore-profile.js';
import { defaultSettings } from '../src/settings-defaults.js';

test('older lore and card fields are kept in one formatted entry', () => {
    const old = '### Mira\nRole: A watchmaker.\nHistory: She moved here last spring.';
    const merged = mergeLoreProfile(old, { age: '34', appearance: 'Dark curls' }, 'Mira');
    assert.equal(merged.profile.age, '34');
    assert.equal(merged.profile.appearance, 'Dark curls');
    assert.match(merged.content, /^Age: 34\nAppearance: Dark curls\n/);
    assert.match(merged.content, /Role: A watchmaker\.\nHistory: She moved here last spring\.$/);
    assert.equal(merged.content.includes('### Mira'), false);
});

test('named fields round trip without duplicating the lore body', () => {
    const text = joinLoreProfile({ age: '34', personality: 'Patient' }, 'Role: A watchmaker.');
    const parsed = splitLoreProfile(`### Mira\n${text}`, 'Mira');
    assert.equal(parsed.profile.age, '34');
    assert.equal(parsed.profile.personality, 'Patient');
    assert.equal(parsed.lore, 'Role: A watchmaker.');
    assert.equal(mergeLoreProfile(text, parsed.profile, 'Mira').content, text);
    assert.match(splitLoreProfile('### A separate heading\nRole: A watchmaker.', 'Mira').lore,
        /^### A separate heading/);
});

test('the default Fill lore prompt requests one ordered Content entry', () => {
    const prompt = defaultSettings.generationPrompt;
    const labels = ['Content:', 'Age: ...', 'Appearance: ...', 'Personality: ...',
        'Warmth & attachment: ...', 'Speech & dialogue style: ...', 'Role: ...'];
    const positions = labels.map(label => prompt.indexOf(label));
    assert.ok(positions.every(position => position >= 0));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
    assert.doesNotMatch(prompt, /Do NOT describe their age/i);
});

test('Fill requests lore and missing profile fields together', async () => {
    const source = readFileSync(new URL('../src/character-fill-lore.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replaceAll('export async function ', 'async function ');
    let calls = 0;
    let saved;
    const fillLore = new Function('loadWorldInfo', 'debugLog', 'getSettings',
        'createLoreEntry', 'generateLoreContent', 'saveLoreContent',
        'tryAutoSyncLorebook', 'getChatLorebookName', 'PROFILE_FIELDS', 'splitLoreProfile',
        `${source}\nreturn fillLore;`)(
        async () => ({ entries: { 0: { content: 'Role: A watchmaker.' } } }),
        () => {}, () => ({ defaultLorebook: 'World' }),
        () => { throw new Error('should reuse linked entry'); },
        async () => { calls++; return { content: 'Age: 34\nRole: A watchmaker.', tags: '' }; },
        async (...args) => { saved = args; }, () => false, () => 'World',
        [{ id: 'age' }], splitLoreProfile,
    );
    const char = { name: 'Mira', profile: { age: '' }, lorebook: { world: 'World', uid: 0 } };
    const result = await fillLore(char);
    assert.equal(result.ok, true);
    assert.equal(calls, 1);
    assert.equal(saved[2], 0);
});
