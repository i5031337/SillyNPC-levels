import assert from 'node:assert/strict';
import test from 'node:test';
import { characterImageDescription } from '../src/api/api-image-description.js';

test('portrait description uses visual profile details filled on the card', () => {
    const char = { profile: {
        age: '  late twenties ',
        appearance: '  Dark curls and a silver scar. ',
        personality: '  Reserved but quick to smile. ',
    } };
    assert.equal(characterImageDescription(char, 'Unrelated lore'),
        'Age: late twenties\nAppearance: Dark curls and a silver scar.');
    assert.equal(characterImageDescription({ profile: {} }, 'Older free-form lore'), 'Older free-form lore');
});
