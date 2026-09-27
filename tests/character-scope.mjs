import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleCharacters, characterPatternSignature } from '../src/characters/character-scope.js';

test('two chats can resolve the same speaker to independent local cards', () => {
    const world = [{ id: 'world', name: 'Mira' }, { id: 'other', name: 'Jon' }];
    const first = [{ id: 'first', name: 'Mira' }];
    const second = [{ id: 'second', name: 'Mira' }];
    assert.deepEqual(visibleCharacters(first, world).map(card => card.id), ['first', 'other']);
    assert.deepEqual(visibleCharacters(second, world).map(card => card.id), ['second', 'other']);
    assert.deepEqual(world.map(card => card.id), ['world', 'other']);
    assert.notEqual(characterPatternSignature(visibleCharacters(first, world)),
        characterPatternSignature(visibleCharacters(second, world)));
});
