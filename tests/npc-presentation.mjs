import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeNpcPresentation, normalizeCharacterPresentation, normalizeSpriteFolder } from '../src/core/npc-presentation.js';

const preferences = {
    expressions: { enabled: true, spriteFolder: 'Mira/casual', fallback: 'joy' },
    voiceDesign: { description: 'A soft, clear voice.', version: 3 },
    voices: {
        Edge: { mode: 'voice', voiceId: 'en-GB-001', voiceName: 'Mira voice' },
        System: { mode: 'disabled' },
        Other: { mode: 'default' },
    },
};

function hostFunction(path, functionName, dependencies) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
        .replaceAll('export ', '');
    return new Function(...Object.keys(dependencies), `${source}\nreturn ${functionName};`)(...Object.values(dependencies));
}

test('old and malformed preferences gain disabled expressions and independent defaults', () => {
    const first = normalizeNpcPresentation();
    const second = normalizeNpcPresentation([]);
    assert.deepEqual(first, second);
    assert.deepEqual(first, { expressions: {
        enabled: false, spriteFolder: '', fallback: 'neutral', bindingStatus: 'unverified',
    }, voiceDesign: { description: '', version: 1 }, voices: {} });
    first.expressions.enabled = true;
    assert.equal(second.expressions.enabled, false);
    assert.equal(normalizeNpcPresentation({ expressions: { enabled: 'true' } }).expressions.enabled, false);
});

test('only documented portable fields survive and provider selections remain separate', () => {
    const raw = structuredClone(preferences);
    raw.apiKey = 'secret';
    raw.expressions.password = 'secret';
    raw.voices.Edge.token = 'secret';
    raw.voices.System.voiceName = 'should not survive disabled mode';
    raw.voices.Bad = { mode: 'unknown', voiceId: 'ignored' };
    raw.voices.__proto__ = { polluted: true };
    const clean = normalizeNpcPresentation(raw);
    assert.equal(JSON.stringify(clean).includes('secret'), false);
    assert.equal(clean.voices.Edge.voiceId, 'en-GB-001');
    assert.equal(clean.voices.System.mode, 'disabled');
    assert.equal(clean.voices.System.voiceName, '');
    assert.equal(clean.voices.Bad.mode, 'default');
    assert.equal(clean.polluted, undefined);
    assert.deepEqual(normalizeNpcPresentation(clean), clean);
    assert.equal(raw.voices.Edge.token, 'secret');
});

test('sprite folder bindings support host depth without paths, traversal, or URLs', () => {
    for (const folder of ['Mira', 'Mira/casual', ' Ágata /casual']) {
        assert.equal(normalizeSpriteFolder(folder), folder.trim());
    }
    for (const folder of ['/tmp/Mira', 'Mira/a/b', '../Mira', 'Mira/..', 'Mira//a',
        'https://host/image.png', 'C:\\sprites', 'Mira?x=1', 'Mira\u0000']) {
        assert.equal(normalizeSpriteFolder(folder), '');
    }
});

test('rename preserves folder and valid card preference references', () => {
    const card = { name: 'Mira', presentation: normalizeNpcPresentation(preferences) };
    const existing = card.presentation;
    card.name = 'Captain Mira';
    normalizeCharacterPresentation(card);
    assert.equal(card.presentation, existing);
    assert.equal(card.presentation.expressions.spriteFolder, 'Mira/casual');
});

test('chat reads repair old metadata without writing into world cards or saving a fixture', () => {
    const world = [{ id: 'world', name: 'Mira', presentation: normalizeNpcPresentation(preferences) }];
    const chat = [{ id: 'chat', name: 'Mira' }];
    let saves = 0;
    const context = { getCurrentChatId: () => 'chat A', chatMetadata: { sillynpc_npcs: chat },
        saveMetadataDebounced: () => saves++ };
    const read = hostFunction('../src/characters/character-repository.js', 'getChatCharacters', {
        getContext: () => context, getSettings: () => ({ characters: world }),
        saveSettings: () => saves++, CHAT_NPCS_KEY: 'sillynpc_npcs', normalizeCharacterPresentation,
    });
    assert.equal(read(), chat);
    assert.equal(chat[0].presentation.expressions.enabled, false);
    chat[0].presentation.voices.Edge = { mode: 'disabled' };
    assert.equal(world[0].presentation.voices.Edge.mode, 'voice');
    assert.equal(saves, 0);
});

test('new cards receive disabled preferences and repository writes follow their owner', () => {
    const world = [];
    let metadataSaves = 0;
    let settingsSaves = 0;
    let currentChatId = 'A';
    const context = { getCurrentChatId: () => currentChatId, chatMetadata: {},
        saveMetadataDebounced: () => metadataSaves++ };
    const repositoryDeps = {
        getContext: () => context, getSettings: () => ({ characters: world }),
        saveSettings: () => settingsSaves++, CHAT_NPCS_KEY: 'sillynpc_npcs', normalizeCharacterPresentation,
    };
    const add = hostFunction('../src/characters/character-repository.js', 'addCharacterRecord', repositoryDeps);
    const create = hostFunction('../src/characters/characters.js', 'createCharacter', {
        makeId: () => 'new', blankActiveProfile: () => ({}), getContext: () => context,
        getLibraryCharacters: () => [], SPEAKER_PALETTE: ['#123456'], paletteColorFor: () => '#123456',
        normalizeNpcPresentation, addCharacterRecord: add, npcTemplateFor: () => null,
    });
    const card = create('Mira');
    assert.deepEqual(card.presentation, normalizeNpcPresentation());
    assert.equal(context.chatMetadata.sillynpc_npcs[0], card);
    assert.equal(metadataSaves, 1);
    assert.equal(settingsSaves, 0);
    currentChatId = undefined;
    const reusable = create('World Mira');
    assert.equal(world[0], reusable);
    assert.equal(settingsSaves, 1);
    assert.equal(metadataSaves, 1);
});

test('reusable card instantiation copies preferences into independent chat instances', () => {
    const world = [{ id: 'world', name: 'Mira', presentation: normalizeNpcPresentation(preferences), statusOverrides: {} }];
    let chat = [];
    let count = 0;
    const instantiate = hostFunction('../src/characters/characters.js', 'instantiateWorldCharacter', {
        getContext: () => ({ getCurrentChatId: () => `chat ${count}` }),
        getWorldCharacters: () => world, getChatCharacters: () => chat,
        makeId: () => `local-${++count}`, initialiseNpcStats: () => ({}), npcStatsFor: () => [],
        getSettings: () => ({ statusTracker: {} }), normalizeNpcPresentation,
        addCharacterRecord: card => chat.push(card), getChatCast: () => ({ categories: null, include: [], exclude: [] }),
    });
    const first = instantiate('world');
    first.presentation.expressions.spriteFolder = 'first-chat';
    first.presentation.voices.Edge.voiceId = 'first-voice';
    first.presentation.voiceDesign.description = 'A different voice.';
    chat = [];
    const second = instantiate('world');
    assert.notEqual(first.id, second.id);
    assert.equal(second.presentation.expressions.spriteFolder, 'Mira/casual');
    assert.equal(second.presentation.voices.Edge.voiceId, 'en-GB-001');
    assert.equal(second.presentation.voiceDesign.description, 'A soft, clear voice.');
    assert.equal(world[0].presentation.voices.Edge.voiceId, 'en-GB-001');
});

test('transfer exports safe preferences and imports explicit unresolved external references', async () => {
    const deps = {
        normalizeNpcPresentation, getSettings: () => ({ statusTracker: {} }), activeNpcSystem: () => ({}),
        npcTemplateFor: () => null, splitNpcStats: () => ({ innate: {} }), profileStrings: () => ({}),
        initialiseNpcStats: () => ({}), npcStatsFor: () => [], blankActiveProfile: () => ({}),
    };
    const serialize = hostFunction('../src/characters/character-transfer.js', 'serialiseCharacter', deps);
    const apply = hostFunction('../src/characters/character-transfer.js', 'applyRecord', deps);
    const record = await serialize({ name: 'Mira', presentation: { ...preferences, apiKey: 'secret' } });
    assert.equal(JSON.stringify(record).includes('secret'), false);
    assert.equal(record.presentation.voices.Edge.bindingStatus, 'unverified');
    const local = { id: 'local' };
    apply(local, record, 'Mira (2)', 2);
    assert.equal(local.id, 'local');
    assert.equal(local.presentation.expressions.spriteFolder, 'Mira/casual');
    assert.equal(local.presentation.expressions.bindingStatus, 'unresolved');
    assert.equal(local.presentation.voices.Edge.bindingStatus, 'unresolved');
    assert.equal(local.presentation.voices.System.mode, 'disabled');
    assert.equal(local.presentation.voices.Other.mode, 'default');
    assert.deepEqual(local.presentation.voiceDesign, { description: 'A soft, clear voice.', version: 3 });
    assert.equal(record.presentation.voices.Edge.bindingStatus, 'unverified');
    apply(local, { name: 'Old' }, 'Old', 1);
    assert.deepEqual(local.presentation, normalizeNpcPresentation());
});
