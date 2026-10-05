import assert from 'node:assert/strict';
import test from 'node:test';
import { characterImageDescription } from '../src/api/api-image-description.js';
import { setProfileSettingsProvider } from '../src/core/profile-fields.js';
import { normalizeSystemDefinition } from '../src/core/system-schema.js';
import { profileSchema } from '../src/generation/contracts.js';
import { validateShape } from '../src/generation/validate-shape.js';
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


test('custom portrait fields use labels and exclude retired, unselected and template-excluded fields', () => {
    const definition = normalizeSystemDefinition({ schemaVersion: 1, profiles: { player: [], npc: [
        { id: 'species', label: 'Species', includeInImagePrompt: true },
        { id: 'clothing', label: 'Outfit', includeInImagePrompt: true },
        { id: 'appearance', label: 'Appearance', includeInImagePrompt: false },
        { id: 'secret', label: 'Secret', includeInImagePrompt: false },
        { id: 'retired', includeInImagePrompt: true, retired: true },
    ] }, npcTemplates: [{ id: 'creature', name: 'Creature', profileIds: ['species', 'appearance', 'secret', 'retired'], statIds: [] }] });
    setProfileSettingsProvider(() => ({ activeSystem: 'custom', statusTracker: { presets: { custom: { definition } } } }));
    try {
        const card = { npcTemplateId: 'creature', profile: {
            species: 'Dragon', clothing: 'Cloak', appearance: 'Excluded', secret: 'Hidden', retired: 'Old',
        } };
        assert.equal(characterImageDescription(card, 'Secret: Hidden'), 'Species: Dragon');
        delete card.profile.species;
        assert.equal(characterImageDescription(card, 'Secret: Hidden'), '');
    } finally { setProfileSettingsProvider(() => null); }
});

test('profile portrait flags survive normalization and are validated as booleans', () => {
    const definition = normalizeSystemDefinition({ schemaVersion: 1, profiles: { player: [], npc: [
        { id: 'age' }, { id: 'appearance', includeInImagePrompt: false },
        { id: 'species', includeInImagePrompt: true }, { id: 'history' },
    ] } });
    assert.deepEqual(definition.profiles.npc.map(field => field.includeInImagePrompt), [true, false, true, false]);
    assert.deepEqual(normalizeSystemDefinition(definition).profiles, definition.profiles);
    assert.deepEqual(validateShape(definition.profiles.npc[2], profileSchema), []);
    assert.ok(validateShape({ ...definition.profiles.npc[2], includeInImagePrompt: 'yes' }, profileSchema)
        .some(error => error.includes('includeInImagePrompt')));
});
