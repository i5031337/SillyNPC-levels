import assert from 'node:assert/strict';
import test from 'node:test';
import { characterImageDescription } from '../src/api/api-image-description.js';
import { imageItemsFromCollections } from '../src/api/api-image-items.js';

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

test('portrait items follow each collection image setting and actor target', () => {
    const definitions = [
        { id: 'clothes', target: 'all', includeInImagePrompt: true, fields: [{ name: 'piece', isPrimary: true }] },
        { id: 'secrets', target: 'all', includeInImagePrompt: false, fields: [{ name: 'name', isPrimary: true }] },
        { id: 'legacy', target: 'npc', fields: [{ name: 'name', isPrimary: true }] },
    ];
    const collections = {
        clothes: [{ piece: 'Red cloak' }, { piece: 'Silver sword' }],
        secrets: [{ name: 'Hidden letter' }],
        legacy: [{ name: 'Silver sword' }, { name: 'Leather boots' }],
        unknown: [{ name: 'Unconfigured item' }],
    };
    assert.equal(imageItemsFromCollections(collections, definitions),
        'Red cloak, Silver sword, Leather boots');
    assert.equal(imageItemsFromCollections(collections, definitions, true),
        'Red cloak, Silver sword');
});
