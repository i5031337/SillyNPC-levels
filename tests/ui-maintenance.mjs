import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

class Element {
    constructor(tag) {
        this.tag = tag;
        this.style = {};
        this.dataset = {};
        this.children = [];
        this.listeners = {};
        this.value = '';
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    async click() { await this.listeners.click?.(); }
}

function load(file, names, values, result) {
    const source = readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replaceAll('export async function ', 'async function ')
        .replaceAll('export function ', 'function ');
    return new Function(...names, `${source}\nreturn ${result};`)(...values);
}

test('linked lore entry with UID zero can generate and save', async () => {
    const elements = [];
    const document = { createElement: tag => {
        const element = new Element(tag);
        elements.push(element);
        return element;
    } };
    let popup;
    class Popup {
        constructor(container) { this.container = container; popup = this; }
        async show() {}
        completeCancelled() { this.closed = true; }
    }
    const saves = [];
    const generateLoreEntry = load('api/ui-api-lore.js', [
        'document', 'Popup', 'POPUP_TYPE', 'world_names', 'getChatLorebookName',
        'getSettings', 'LOG_PREFIX', 'createLoreEntry', 'generateLoreContent',
        'saveLoreContent', 'toastr',
    ], [
        document, Popup, { DISPLAY: 1 }, ['World'], () => 'World',
        () => ({ defaultLorebook: 'World' }), '[test]', () => {},
        async () => ({ tags: 'friend', content: 'A useful entry', followedFormat: true }),
        async (...args) => saves.push(args),
        { warning() {}, info() {}, success() {}, error() {} },
    ], 'generateLoreEntry');
    const char = { name: 'Mira', lorebook: { world: 'World', uid: 0 } };
    let onSave = 0;
    await generateLoreEntry(char, { onSave: () => onSave++ });
    const generate = elements.find(el => el.innerHTML?.includes('Start Generation'));
    const save = elements.find(el => el.innerHTML?.includes('Save & Close'));
    await generate.click();
    await save.click();
    assert.deepEqual(saves, [[char, 'World', 0, 'friend', 'A useful entry']]);
    assert.equal(onSave, 1);
    assert.equal(popup.closed, true);
});

test('editor resolves a removed Pictures tab before building its tab bar', async () => {
    const document = { createElement: tag => new Element(tag) };
    const editorView = new Element('div');
    const char = { id: 'mira', name: 'Mira' };
    const manageState = {
        editingCharId: char.id,
        charView: 'pictures',
        manageRoot: { querySelector: () => editorView },
    };
    let profileRendered = false;
    const renderEditor = load('manage/ui-manage-editor.js', [
        'document', 'manageState', 'findCharacter',
        'taggedFields', 'renderProfileView', 'LOG_PREFIX',
    ], [
        document, manageState, () => char, () => [],
        async () => { profileRendered = true; }, '[test]',
    ], 'renderEditor');
    let showGrid = 0;
    renderEditor(() => showGrid++);
    await Promise.resolve();
    assert.equal(manageState.charView, 'profile');
    assert.equal(profileRendered, true);
    const sticky = editorView.children[0];
    const tabBar = sticky.children[1];
    assert.equal(tabBar.children.some(tab => tab.dataset.view === 'pictures'), false);
    await sticky.children[0].children[0].click();
    assert.equal(manageState.editingCharId, null);
    assert.equal(showGrid, 1);
});

test('new character card opens its editor through the supplied callback', async () => {
    const document = { createElement: tag => new Element(tag) };
    const addedToChat = [];
    const buildAddCard = load('manage/ui-manage-cards.js', [
        'document', 'createCharacter', 'addCharacterToChat',
    ], [
        document, () => ({ id: 'new-character' }), id => addedToChat.push(id),
    ], 'buildAddCard');
    const opened = [];
    await buildAddCard(id => opened.push(id)).click();
    assert.deepEqual(addedToChat, ['new-character']);
    assert.deepEqual(opened, ['new-character']);
});
