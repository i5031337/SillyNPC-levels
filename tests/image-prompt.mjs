import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/api/api-image-generate.js', import.meta.url), 'utf8')
    .split('function escapeCommandValue')[0].replace(/^import .*;\n/gm, '').replaceAll('export ', '');
function fixture() {
    const calls = [];
    const settings = { imgGenPromptPrefix: '' };
    const dependencies = {
        getSettings: () => settings,
        resolveImagePrompt: () => '{{name}} | {{lore}} | {{items}}',
        fillImagePrompt: (template, values) => template.replace(/{{(\w+)}}/g, (_, key) => values[key]),
        describeCarriedItems: () => 'Red coat',
        characterImageDescription: () => 'Species: Elf',
        loadWorldInfo: async () => ({ entries: [{ uid: 1, content: 'Lore' }] }),
        debugLog() {},
        generateImage: async (prompt, options) => { calls.push({ prompt, options }); return '/portrait.png'; },
    };
    const api = new Function(...Object.keys(dependencies), `${source}\nreturn { buildCharacterImagePrompt, generateCharacterImageLogic };`)
        (...Object.values(dependencies));
    return { ...api, calls, settings };
}

test('portrait preview uses profile and items without making an image request', async () => {
    const f = fixture();
    const card = { name: 'Mira', lorebook: { world: 'World', uid: 1 } };
    assert.equal(await f.buildCharacterImagePrompt(card), 'Mira | Species: Elf | Red coat');
    assert.deepEqual(f.calls, []);
});

test('manual edited prompt is sent verbatim with ownership and blanks are rejected', async () => {
    const f = fixture();
    const card = { name: 'Mira' };
    const prompt = 'Custom outfit\nKeep this exact prompt';
    assert.equal(await f.generateCharacterImageLogic(card, { prompt }), '/portrait.png');
    assert.deepEqual(f.calls, [{ prompt, options: { owner: card } }]);
    await assert.rejects(f.generateCharacterImageLogic(card, { prompt: '  ' }), /Enter an image prompt/);
    assert.equal(f.calls.length, 1);
});


test('portrait prefix precedes the description in preview and automatic requests and can be cleared', async () => {
    const f = fixture();
    const card = { name: 'Mira' };
    f.settings.imgGenPromptPrefix = '  Solo, profile picture  ';
    const expected = 'Solo, profile picture\nMira | Species: Elf | Red coat';
    assert.equal(await f.buildCharacterImagePrompt(card), expected);
    await f.generateCharacterImageLogic(card);
    assert.equal(f.calls[0].prompt, expected);
    await f.generateCharacterImageLogic(card, { prompt: 'Manually replaced prompt' });
    assert.equal(f.calls[1].prompt, 'Manually replaced prompt');
    f.settings.imgGenPromptPrefix = '';
    assert.equal(await f.buildCharacterImagePrompt(card), 'Mira | Species: Elf | Red coat');
});
