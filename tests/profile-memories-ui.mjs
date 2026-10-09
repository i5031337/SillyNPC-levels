import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMemorySection } from '../src/ui/characters/ui-memories.js';

class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; this.dataset = {}; this.classList = { add() {} }; }
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
    const wrapper = renderMemorySection(root, {
        read: () => store, write: next => { store = next; },
        fields: [{ id: 'history', label: 'History' }],
    });
    const section = wrapper.children[1];
    assert.equal(section.children[1].children[1].children[1].textContent, 'History · Message 8');
    const archived = section.children[2].children[1].children[0];
    archived.children[0].value = 'Corrected event';
    archived.children[2].children[0].listeners.click();
    assert.equal(store.archive[0].text, 'Corrected event');
    assert.equal(store.archive[0].sourceMessageId, '3');
    assert.equal(store.archive[0].editedManually, true);
    section.children[1].children[1].children[2].children[1].listeners.click();
    assert.equal(store.entries.length, 0);
    assert.equal(store.archive.length, 1);
});

test('manual memories need no Memory profile field and archive at the configured cap', () => {
    globalThis.document = { createElement: tag => new Element(tag) };
    let store = { entries: [{ id: 'm1', text: 'First', fieldId: 'history', manual: true }], archive: [] };
    const wrapper = renderMemorySection(new Element('div'), {
        read: () => store, write: next => { store = next; }, limit: 1,
        fields: [{ id: 'role', label: 'Role' }],
    });
    const section = wrapper.children[1];
    const form = section.children[0];
    assert.deepEqual(form.children.map(child => child.tag), ['textarea', 'button']);
    form.children[0].value = 'Made a promise';
    form.children[1].listeners.click();
    assert.equal(store.entries[0].text, 'Made a promise');
    assert.equal(store.entries[0].fieldId, undefined);
    assert.equal(store.entries[0].manual, true);
    assert.equal(store.archive[0].text, 'First');
    assert.equal(section.children[1].children[1].children[1].textContent, 'Manually added');
});

test('memory sheet displays one-based provenance message references and handles absent sources', () => {
    globalThis.document = { createElement: tag => new Element(tag) };
    const store = { entries: [{ text: 'A shared event', provenance: { systemId: 'test', sources: [
        { messageId: 0, swipeId: 0, text: 'First reply' },
        { messageId: 2, swipeId: 1, text: 'Later reply' },
    ] } }, { text: 'Old memory', sourceMessageId: '8' }] };
    const wrapper = renderMemorySection(new Element('div'), { read: () => store, write: () => {} });
    const section = wrapper.children[1];
    assert.equal(section.children[1].children[1].children[1].textContent, 'Messages 1, 3');
    assert.equal(section.children[1].children[2].children[1].textContent, 'Message 8');
});
