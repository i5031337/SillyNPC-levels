import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMemorySection } from '../src/ui/characters/ui-memories.js';

class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    setAttribute() {}
}

test('memory sheet edits and removes active and archived entries with sources visible', () => {
    globalThis.document = { createElement: tag => new Element(tag) };
    let store = { entries: [{ id: 'm1', text: 'A promise', fieldId: 'history', sourceMessageId: '8' }],
        archive: [{ id: 'm2', text: 'An older event', sourceMessageId: '3' }] };
    const root = new Element('div');
    const section = renderMemorySection(root, {
        read: () => store, write: next => { store = next; },
        fields: [{ id: 'history', label: 'History' }],
    });
    assert.equal(section.children[1].children[1].children[1].textContent, 'History · Message 8');
    const archived = section.children[2].children[1];
    archived.children[0].value = 'Corrected event';
    archived.children[2].children[0].listeners.click();
    assert.equal(store.archive[0].text, 'Corrected event');
    assert.equal(store.archive[0].sourceMessageId, '3');
    assert.equal(store.archive[0].editedManually, true);
    section.children[1].children[1].children[2].children[1].listeners.click();
    assert.equal(store.entries.length, 0);
    assert.equal(store.archive.length, 1);
});

test('manual memories choose a System field and archive at its configured cap', () => {
    globalThis.document = { createElement: tag => new Element(tag) };
    let store = { entries: [{ id: 'm1', text: 'First', fieldId: 'history', manual: true }], archive: [] };
    const section = renderMemorySection(new Element('div'), {
        read: () => store, write: next => { store = next; }, limit: 1,
        fields: [
            { id: 'history', label: 'History', policy: 'memory' },
            { id: 'bond', label: 'Bond', policy: 'memory' },
            { id: 'role', label: 'Role', policy: 'replaceable' },
        ],
    });
    const form = section.children[1];
    assert.deepEqual(form.children[0].children.map(option => option.value), ['history', 'bond']);
    form.children[0].value = 'bond';
    form.children[1].value = 'Made a promise';
    form.children[2].listeners.click();
    assert.equal(store.entries[0].text, 'Made a promise');
    assert.equal(store.entries[0].fieldId, 'bond');
    assert.equal(store.entries[0].manual, true);
    assert.equal(store.archive[0].text, 'First');
    assert.equal(section.children[2].children[1].children[1].textContent, 'Bond · Manually added');
});
