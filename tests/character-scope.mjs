import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleCharacters, canAutoLinkLorebook } from '../src/characters/character-scope.js';

test('two chats can resolve the same speaker to independent local cards', () => {
    const world = [{ id: 'world', name: 'Mira' }, { id: 'other', name: 'Jon' }];
    const first = [{ id: 'first', name: 'Mira' }];
    const second = [{ id: 'second', name: 'Mira' }];
    assert.deepEqual(visibleCharacters(first, world).map(card => card.id), ['first', 'other']);
    assert.deepEqual(visibleCharacters(second, world).map(card => card.id), ['second', 'other']);
    assert.deepEqual(world.map(card => card.id), ['world', 'other']);
});

test('a fresh chat profile cannot silently adopt a same-name lore entry', () => {
    const fresh = { name: 'Mira', autoLinkLorebook: false };
    assert.equal(canAutoLinkLorebook(fresh), false);
    assert.equal(canAutoLinkLorebook(fresh, true), true);
    assert.equal(canAutoLinkLorebook({ name: 'Mira' }), true);
});
