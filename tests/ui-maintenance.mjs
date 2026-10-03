import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { statPolicyMarkup } from '../src/ui/system/ui-system-stat-policy.js';

test('System Builder uses update authority and level bonuses without transfer selector', () => {
    const escape = text => text;
    const npc = statPolicyMarkup({ name: 'Wisdom', persistence: 'innate',
        updatePolicy: 'turn' }, 'npcStats', true, escape);
    assert.match(npc, /class="text_pole stat-update-policy"/);
    assert.match(npc, /value="turn" selected/);
    assert.doesNotMatch(npc, /stat-persistence|Innate|Variable/);
    assert.doesNotMatch(npc, /stat-advance-on-level/);

    const player = statPolicyMarkup({ name: 'Strength', advanceOnLevel: true },
        'playerStats', true, escape);
    assert.match(player, /stat-advance-on-level" checked/);
    assert.doesNotMatch(player, /stat-persistence/);
});

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

test('tracker display controls redraw immediately without reprocessing chat or rebuilding settings', () => {
    const document = { createElement: tag => new Element(tag) };
    const control = options => ({ ...options, style: {} });
    const display = load('tracker/ui-tracker-display-reading.js', [
        'buildSettingToggle', 'buildSettingSlider', 'buildSettingSelect', 'buildSettingNumber',
        'buildPlacementPicker', 'buildHistoryNoteFields', 'buildConnectionProfilePicker',
    ], [control, control, control, control,
        (settings, onChange) => control({ key: 'placement', onChange }), control, control,
    ], 'renderTrackerDisplayAndReading');
    const counts = { save: 0, redraw: 0, reprocess: 0, hud: 0 };
    const render = load('tracker/ui-tracker-settings.js', [
        'document', 'getSettings', 'saveSettings', 'triggerReprocess', 'updateHUD',
        'redrawStatusBoxes', 'renderTrackerDisplayAndReading', 'renderTrackerScanAndReview',
        'renderTrackerCastAndRecovery', 'foldSettings',
    ], [document, () => ({ statusTracker: {} }), () => counts.save++,
        () => counts.reprocess++, () => counts.hud++, () => counts.redraw++,
        display, () => {}, () => {}, () => {},
    ], 'renderStatusView');
    const panel = new Element('div');
    render(panel);
    const children = [...panel.children];
    const keys = ['placement', ...['showGlobalStats', 'showPlayerStats', 'showNpcStats',
        'showRawTrackerOutput', 'showNpcPortraits', 'characterColumns', 'summaryThreshold']
        .map(key => `statusTracker.${key}`)];
    for (const [index, key] of keys.entries()) {
        const setting = panel.children.find(child => child.key === key);
        assert.ok(setting, key);
        setting.onChange();
        assert.deepEqual(counts, { save: index + 1, redraw: index + 1, reprocess: 0, hud: 0 });
        assert.deepEqual(panel.children, children);
    }
});

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
    const warnings = [];
    const generateLoreEntry = load('api/ui-api-lore.js', [
        'document', 'Popup', 'POPUP_TYPE', 'world_names', 'getChatLorebookName',
        'getSettings', 'LOG_PREFIX', 'createLoreEntry', 'generateLoreContent',
        'saveLoreContent', 'toastr',
    ], [
        document, Popup, { DISPLAY: 1 }, ['World'], () => 'World',
        () => ({ defaultLorebook: 'World' }), '[test]', () => {},
        async () => ({ tags: 'friend', content: 'A useful entry', followedFormat: true, truncated: true }),
        async (...args) => saves.push(args),
        { warning(message) { warnings.push(message); }, info() {}, success() {}, error() {} },
    ], 'generateLoreEntry');
    const char = { name: 'Mira', lorebook: { world: 'World', uid: 0 } };
    let onSave = 0;
    await generateLoreEntry(char, { onSave: () => onSave++ });
    const generate = elements.find(el => el.innerHTML?.includes('Start Generation'));
    const save = elements.find(el => el.innerHTML?.includes('Save & Close'));
    await generate.click();
    assert.match(elements.find(el => el.className === 'sillynpc-lore-warning').textContent, /token limit/);
    assert.equal(warnings.length, 1);
    await save.click();
    assert.deepEqual(saves, [[char, 'World', 0, 'friend', 'A useful entry', { preserveEmpty: true }]]);
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
