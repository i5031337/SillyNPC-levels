import { collectionQuantityField } from '../src/core/collection-fields.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { promptText } from '../src/prompts/prompt-texts.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export function ', 'function ') + `\n${collectionQuantityField.toString()}\n`;

test('a turn with no activated lore drops previous references and a later activation restores them', () => {
    const card = { name: 'Mira', lorebook: { world: 'Cast', uid: 1 }, statusOverrides: { HP: 7 } };
    const lore = new Function('getAllCharacters', source('../src/lore/activated-lore.js')
        + '\nreturn { noteActivatedLore, charactersFromActivatedLore };')(() => [card]);
    const settings = { enabled: true, statusTracker: { enabled: true, extractionMode: 'extract', collections: [] } };
    const deps = { committedState: { characters: [], player: { name: 'Hero', stats: {} } },
        statsInSystem: stats => stats || {} };
    new Function('promptText', 'getSettings', 'charactersFromActivatedLore',
        source('../src/tracker/status-status-summary.js') + '\nreturn bind;')(
        promptText, () => settings, lore.charactersFromActivatedLore)(deps);
    const prompts = new Map();
    new Function('getSettings', 'noteActivatedLore', 'setExtensionPrompt',
        'extension_prompt_types', 'extension_prompt_roles', 'debugLog',
        source('../src/tracker/status-scene-prompt.js') + '\nreturn bind;')(
        () => settings, lore.noteActivatedLore, (key, value) => prompts.set(key, value),
        { IN_CHAT: 1 }, { SYSTEM: 0 }, error => { throw error; })(deps);
    const activated = [{ world: 'Cast', uid: 1 }];
    const scene = () => prompts.get('sillynpc-status-scene');
    lore.noteActivatedLore(activated);
    deps.applyScenePrompt();
    assert.match(scene(), /Other known characters[\s\S]*Mira - HP=7/);
    deps.onGenerationStarted('normal', {}, false);
    assert.doesNotMatch(scene(), /Other known characters|Mira/);
    lore.noteActivatedLore(activated);
    deps.applyScenePrompt();
    assert.match(scene(), /Mira - HP=7/);
    deps.onGenerationStarted('normal', {}, true);
    assert.match(scene(), /Mira - HP=7/);
});
