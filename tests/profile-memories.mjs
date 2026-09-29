import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMemoryStore, appendMemory, editMemory, removeMemory }
    from '../src/core/profile-memories.js';

test('legacy strings receive stable IDs and manual provenance', () => {
    const source = ['Met the captain', 'Saw the harbor'];
    const first = normalizeMemoryStore(source);
    assert.deepEqual(first.entries.map(entry => entry.id), ['memory-1', 'memory-2']);
    assert.equal(first.entries[0].manual, true);
    assert.deepEqual(normalizeMemoryStore(first), first);
    assert.deepEqual(source, ['Met the captain', 'Saw the harbor']);
});

test('sourced turns dedupe regeneration and archive oldest entries', () => {
    const first = appendMemory([], { text: 'Found a map', sourceMessageId: 'turn-1', fieldId: 'history' }, 1);
    assert.equal(first.added, true);
    const replay = appendMemory(first.store, { text: '  found  a MAP ', sourceMessageId: 'turn-1', fieldId: 'history' }, 1);
    assert.equal(replay.added, false);
    const repeatedLater = appendMemory(first.store, { text: 'Found a map', sourceMessageId: 'turn-9', fieldId: 'history' }, 1);
    assert.equal(repeatedLater.added, false);
    const next = appendMemory(replay.store, { text: 'Opened a door', sourceMessageId: 'turn-2', fieldId: 'history' }, 1);
    assert.deepEqual(next.store.archive.map(entry => entry.text), ['Found a map']);
    assert.deepEqual(next.store.entries.map(entry => entry.text), ['Opened a door']);
    assert.equal(appendMemory(next.store, { text: 'Found a map', sourceMessageId: 'turn-1', fieldId: 'history' }, 1).added, false);
});

test('archived memories can be corrected and removed without changing source data', () => {
    const source = normalizeMemoryStore(['First', 'Second'], 1);
    const changed = editMemory(source, source.archive[0].id, 'Corrected first');
    assert.equal(changed.archive[0].text, 'Corrected first');
    assert.equal(changed.archive[0].editedManually, true);
    assert.equal(source.archive[0].text, 'First');
    const removed = removeMemory(changed, source.archive[0].id);
    assert.equal(removed.archive.length, 0);
    assert.equal(removed.entries.length, 1);
});
