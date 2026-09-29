import assert from 'node:assert/strict';
import test from 'node:test';
import { readNpcMemories, writeNpcMemories, cardsWithChangedMemories } from '../src/tracker/npc-memories.js';

test('NPC memories stay chat local after scene departure', () => {
    const card = { id: 'card-8', name: 'Mira', memories: ['Old card note'] };
    const first = { characters: [{ name: 'Mira', memories: ['Actor note'] }] };
    const second = { characters: [] };
    const initial = readNpcMemories(first, card);
    assert.equal(initial.entries[0].text, 'Actor note');
    writeNpcMemories(first, card, initial);
    first.characters = [];
    assert.equal(readNpcMemories(first, card).entries[0].text, 'Actor note');
    assert.equal(readNpcMemories(second, card).entries[0].text, 'Old card note');
    assert.equal(second.npcMemories, undefined);
});

test('stable card ID wins over name after rename', () => {
    const state = { characters: [] };
    writeNpcMemories(state, { id: 9, name: 'Mira' }, ['Remembers the gate']);
    assert.equal(readNpcMemories(state, { id: 9, name: 'Mirabel' }).entries[0].text,
        'Remembers the gate');
});

test('reply removal selects NPC lore whose memory section must be cleared', () => {
    const card = { id: 'mira', name: 'Mira' };
    const before = { npcMemories: { 'id:mira': { entries: [{ text: 'Found a map' }], archive: [] } } };
    const after = { npcMemories: { 'id:mira': { entries: [], archive: [] } } };
    assert.deepEqual(cardsWithChangedMemories(before, after, [card]), [card]);
    assert.deepEqual(cardsWithChangedMemories(after, after, [card]), []);
});
