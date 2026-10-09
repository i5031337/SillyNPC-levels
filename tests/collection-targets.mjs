import { collectionQuantityField } from '../src/core/collection-fields.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSystemDefinition } from '../src/core/system-schema.js';
import { setNpcTemplateSettingsProvider } from '../src/core/npc-templates.js';
import { collectionAppliesTo, collectionTargetLabel, collectionTargets } from '../src/core/collection-targets.js';
import { normalizeCollectionUpdates } from '../src/tracker/extractor/status-collection-normalize.js';
import { imageItemsFromCollections } from '../src/api/api-image-items.js';

const definition = normalizeSystemDefinition({ schemaVersion: 1, name: 'Types',
    npcTemplates: [{ id: 'human', name: 'Human' }, { id: 'pokemon', name: 'Pokémon' }],
    collections: [
        { id: 'moves', name: 'Moves', target: 'npc', npcTemplateId: 'pokemon', fields: [{ name: 'name', isPrimary: true }] },
        { id: 'clothes', name: 'Clothing', targets: ['player', 'template:human'], fields: [{ name: 'name', isPrimary: true }] },
    ],
});
const tracker = { collections: definition.collections };
const settings = { activeSystem: 'Types', statusTracker: { ...tracker, presets: { Types: { definition } } } };
const human = { name: 'Trainer', npcTemplateId: 'human', collections: {} };
const pokemon = { name: 'Pikachu', npcTemplateId: 'pokemon', collections: {} };
function fixture() { setNpcTemplateSettingsProvider(() => settings); }
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export function ', 'function ') + `\n${collectionQuantityField.toString()}\n`;

test('template collection targets survive normalization and never widen a missing template to all NPCs', () => {
    fixture();
    assert.deepEqual(normalizeSystemDefinition(definition), definition);
    const moves = tracker.collections[0];
    assert.equal(collectionAppliesTo(moves, 'npc', pokemon), true);
    assert.equal(collectionAppliesTo(moves, 'npc', human), false);
    assert.equal(collectionAppliesTo(moves, 'npc', {}), false);
    assert.equal(collectionAppliesTo(moves, 'player', pokemon), false);
    assert.equal(collectionAppliesTo(moves, 'npc'), true); // scope-wide extraction schema
    assert.equal(collectionAppliesTo({ ...moves, targets: ['template:deleted'] }, 'npc', pokemon), false);
    assert.match(collectionTargetLabel(moves), /Pokémon.*npcTemplateId: pokemon/);
    for (const scope of ['player', 'npc']) assert.equal(collectionAppliesTo({ target: 'all' }, scope, {}), true);
    assert.equal(collectionAppliesTo({ target: 'npc' }, 'npc', {}), true);
    assert.equal(collectionAppliesTo({ target: 'player' }, 'npc', human), false);
});

test('unnamed collection changes resolve using an established template or a valid new assignment', () => {
    fixture();
    const update = { player: { collections: { add: [{ name: 'Player coat' }] } }, characters: [
        { name: human.name, npcTemplateId: 'pokemon', collections: { add: [{ name: 'Coat' }] } },
        { name: 'New Pokémon', npcTemplateId: 'pokemon', collections: { add: [{ name: 'Thunderbolt' }] } },
        { name: 'Unknown', collections: { add: [{ name: 'Guess' }] } },
    ] };
    const warnings = normalizeCollectionUpdates(update, tracker, { characters: [human] });
    assert.deepEqual(update.player.collections, { clothes: { add: [{ name: 'Player coat' }] } });
    assert.deepEqual(update.characters[0].collections, { clothes: { add: [{ name: 'Coat' }] } });
    assert.deepEqual(update.characters[1].collections, { moves: { add: [{ name: 'Thunderbolt' }] } });
    assert.equal(update.characters[2].collections, undefined);
    assert.match(warnings[0], /0 possible collections/);
});

test('model adds, removals, updates and replacements cannot change another template’s collection', () => {
    fixture();
    const deps = { committedState: {}, getCurrentPersonaName: () => 'Player',
        constrainToDefinition: (field, value) => value,
        getMergedItem: (id, item) => item,
    };
    new Function('collectionAppliesTo', 'getSettings', 'debugLog', 'LOG_PREFIX',
        `${source('../src/tracker/status-collection-updates.js')}\nreturn bind;`)(
        collectionAppliesTo, () => settings, () => {}, 'test')(deps);
    const trainer = { ...human, collections: { moves: [{ name: 'Old move' }] } };
    for (const update of [
        { add: [{ name: 'New move' }] }, { remove: ['Old move'] },
        { update: [{ name: 'Old move', other: 'changed' }] },
        { replace: [{ name: 'Replacement' }] }, { clear: true },
    ]) deps.applyCollectionUpdate(trainer, 'moves', update, { allowReplace: true });
    assert.deepEqual(trainer.collections, { moves: [{ name: 'Old move' }] });
    const pikachu = structuredClone(pokemon);
    deps.applyCollectionUpdate(pikachu, 'MOVES', { add: [{ name: 'Thunderbolt' }] });
    assert.deepEqual(pikachu.collections.moves, [{ name: 'Thunderbolt' }]);
    deps.applyCollectionUpdate(pikachu, 'moves', { remove: ['Thunderbolt'] });
    assert.deepEqual(pikachu.collections.moves, []);
    deps.applyCollectionUpdate(pikachu, 'moves', { replace: [{ name: 'Quick Attack' }] });
    assert.deepEqual(pikachu.collections.moves, [{ name: 'Quick Attack' }]);
});

test('portrait prompts hide belongings retained from a previous template', () => {
    fixture();
    const stored = { moves: [{ name: 'Thunderbolt' }], clothes: [{ name: 'Red coat' }] };
    assert.equal(imageItemsFromCollections(stored, tracker.collections, false, human), 'Red coat');
    assert.equal(imageItemsFromCollections(stored, tracker.collections, false, pokemon), 'Thunderbolt');
    assert.equal(imageItemsFromCollections(stored, tracker.collections, true, human), 'Red coat');
});

test('multiple targets include the player and humans, exclude Pokémon, and survive System export/import', () => {
    fixture();
    const clothes = tracker.collections[1];
    assert.deepEqual(clothes.targets, ['player', 'template:human']);
    assert.equal(collectionAppliesTo(clothes, 'player', { name: 'Player' }), true);
    assert.equal(collectionAppliesTo(clothes, 'npc', human), true);
    assert.equal(collectionAppliesTo(clothes, 'npc', pokemon), false);
    assert.equal(collectionAppliesTo(clothes, 'npc', {}), false);
    const imported = normalizeSystemDefinition(JSON.parse(JSON.stringify(definition)));
    assert.deepEqual(imported.collections[1], clothes);
    assert.equal(collectionTargetLabel(clothes), 'player or Human NPCs (npcTemplateId: human)');
    const several = { targets: ['template:human', 'template:pokemon'] };
    assert.equal(collectionAppliesTo(several, 'player'), false);
    assert.equal(collectionAppliesTo(several, 'npc', human), true);
    assert.equal(collectionAppliesTo(several, 'npc', pokemon), true);
    assert.equal(collectionAppliesTo({ targets: ['player', 'npc'] }, 'npc', {}), true);
});

test('empty selections stay disabled and older single targets migrate without widening', () => {
    fixture();
    assert.deepEqual(collectionTargets({ target: 'all' }), ['player', 'npc']);
    assert.deepEqual(collectionTargets({ target: 'npc' }), ['npc']);
    assert.deepEqual(collectionTargets({ target: 'player' }), ['player']);
    assert.deepEqual(collectionTargets({ target: 'npc', npcTemplateId: 'human' }), ['template:human']);
    assert.deepEqual(collectionTargets({ targets: ['player', 'player', 'template:human', null, 'invalid'] }), ['player', 'template:human']);
    const empty = normalizeSystemDefinition({ schemaVersion: 1, collections: [{ id: 'off', targets: [], target: 'all' }] });
    assert.deepEqual(empty.collections[0].targets, []);
    assert.deepEqual(normalizeSystemDefinition(empty), empty);
    assert.equal(collectionAppliesTo(empty.collections[0], 'player'), false);
    assert.equal(collectionAppliesTo(empty.collections[0], 'npc', human), false);
    assert.equal(collectionAppliesTo(empty.collections[0], 'npc'), false);
});

test('shared collections accept updates for the player and humans while refusing Pokémon', () => {
    fixture();
    const deps = { committedState: {}, getCurrentPersonaName: () => 'Player',
        constrainToDefinition: (field, value) => value,
        getMergedItem: (id, item) => item,
    };
    new Function('collectionAppliesTo', 'getSettings', 'debugLog', 'LOG_PREFIX',
        `${source('../src/tracker/status-collection-updates.js')}\nreturn bind;`)(
        collectionAppliesTo, () => settings, () => {}, 'test')(deps);
    for (const actor of [{ name: 'Player', collections: {} }, structuredClone(human), structuredClone(pokemon)]) {
        const before = structuredClone(actor);
        deps.applyCollectionUpdate(actor, 'clothes', { add: [{ name: 'Coat' }] });
        if (actor.npcTemplateId === 'pokemon') assert.deepEqual(actor, before);
        else assert.deepEqual(actor.collections.clothes, [{ name: 'Coat' }]);
    }
});
