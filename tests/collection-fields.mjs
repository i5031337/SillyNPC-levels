import { readFileSync } from 'node:fs';
import { collectionAppliesTo } from '../src/core/collection-targets.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureCollectionIdentifier, moveCollectionField, deleteCollectionField } from '../src/core/collection-fields.js';
import { normalizeSystemDefinition } from '../src/core/system-schema.js';

const normalize = fields => normalizeSystemDefinition({ schemaVersion: 1,
    collections: [{ id: 'moves', fields }] }).collections[0];

test('an existing custom identifier moves to the top without changing stored field keys or values', () => {
    const col = { fields: [{ name: 'pp', type: 'number' }, { name: 'move', isPrimary: true }, { name: 'description' }] };
    const identifier = col.fields[1];
    const item = { move: 'Thunderbolt', pp: 12, description: 'Electric move' };
    assert.equal(ensureCollectionIdentifier(col), true);
    assert.equal(col.fields[0], identifier);
    assert.deepEqual(col.fields.map(field => field.name), ['move', 'pp', 'description']);
    assert.deepEqual(col.fields.map(field => field.isPrimary), [true, false, false]);
    assert.equal(item[col.fields[0].name], 'Thunderbolt');
    assert.equal(ensureCollectionIdentifier(col), false);
});

test('missing and duplicate Primary flags are repaired deterministically and normalization is idempotent', () => {
    for (const fields of [[], [{ name: 'hp', type: 'number' }],
        [{ name: 'quantity' }, { name: 'name' }],
        [{ name: 'name', isPrimary: true }, { name: 'other', isPrimary: true }]]) {
        const col = normalize(fields);
        assert.ok(col.fields.length > 0);
        assert.equal(col.fields[0].isPrimary, true);
        assert.equal(col.fields.filter(field => field.isPrimary).length, 1);
        assert.deepEqual(normalize(col.fields), col);
    }
    assert.equal(normalize([]).fields[0].name, 'name');
    assert.equal(normalize([{ name: 'hp', type: 'number' }]).fields[0].name, 'hp');
    assert.equal(normalize([{ name: 'quantity' }, { name: 'name' }]).fields[0].name, 'name');
});

test('reorder and delete operations cannot replace the identifier, even after every other field is removed', () => {
    const col = normalize([{ name: 'name', isPrimary: true }, { name: 'pp' }, { name: 'description' }]);
    const identifier = col.fields[0];
    assert.equal(moveCollectionField(col, 0, 1), false);
    assert.equal(moveCollectionField(col, 1, -1), false);
    assert.equal(deleteCollectionField(col, 0), false);
    assert.equal(moveCollectionField(col, 2, -1), true);
    assert.deepEqual(col.fields.map(field => field.name), ['name', 'description', 'pp']);
    assert.equal(deleteCollectionField(col, 2), true);
    assert.equal(deleteCollectionField(col, 1), true);
    assert.equal(deleteCollectionField(col, 0), false);
    assert.deepEqual(col.fields, [identifier]);
});


test('reader changes use the pinned custom identifier instead of assuming a name field', () => {
    const collection = normalize([{ name: 'pp', type: 'number' }, { name: 'move', isPrimary: true }]);
    const source = readFileSync(new URL('../src/tracker/status-collection-updates.js', import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replace('export function bind', 'function bind');
    const deps = { committedState: {}, getCurrentPersonaName: () => 'Player',
        constrainToDefinition: (field, value) => value };
    new Function('collectionAppliesTo', 'getSettings', 'debugLog', 'LOG_PREFIX', source + '\nreturn bind;')(
        collectionAppliesTo, () => ({ statusTracker: { collections: [collection] } }), () => {}, 'test')(deps);
    const actor = { name: 'Player', collections: {} };
    deps.applyCollectionUpdate(actor, 'moves', { add: [{ move: 'Thunderbolt', pp: 15 }] });
    deps.applyCollectionUpdate(actor, 'moves', { update: [{ move: 'Thunderbolt', pp: 14 }] });
    assert.deepEqual(actor.collections.moves, [{ move: 'Thunderbolt', pp: 14 }]);
});

test('numeric collection ranges survive System export/import and text choices remain intact', () => {
    const col = normalize([
        { name: 'name', isPrimary: true },
        { name: 'pp', type: 'number', min: 0, maxStatValue: 40, options: ['1', '2'] },
        { name: 'condition', type: 'text', options: ['New', 'Worn'] },
        { name: 'quantity', type: 'number' },
    ]);
    assert.equal(col.fields[1].min, '0');
    assert.equal(col.fields[1].maxStatValue, '40');
    assert.equal(col.fields[1].options, undefined);
    assert.deepEqual(col.fields[2].options, ['New', 'Worn']);
    assert.equal(col.fields[3].min, '');
    assert.equal(col.fields[3].maxStatValue, '');
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(col.fields))), col);
});

test('collection additions, replacements, defaults and updates respect optional numeric ranges', async () => {
    const { constrainNumericStat } = await import('../src/tracker/numeric-stat-bounds.js');
    const col = normalize([{ name: 'name', isPrimary: true },
        { name: 'pp', type: 'number', min: '-2.5', maxStatValue: '5.5', defaultValue: '99' },
        { name: 'unbounded', type: 'number' }]);
    const source = readFileSync(new URL('../src/tracker/status-collection-updates.js', import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replace('export function bind', 'function bind');
    const deps = { committedState: {}, getCurrentPersonaName: () => 'Player',
        constrainToDefinition: constrainNumericStat, getMergedItem: (id, item) => item };
    new Function('collectionAppliesTo', 'getSettings', 'debugLog', 'LOG_PREFIX', source + '\nreturn bind;')(
        collectionAppliesTo, () => ({ statusTracker: { collections: [col] } }), () => {}, 'test')(deps);
    const actor = { name: 'Player', collections: {} };
    deps.applyCollectionUpdate(actor, 'moves', { add: [{ name: 'Thunderbolt', pp: 10, unbounded: 999 }] });
    assert.deepEqual(actor.collections.moves, [{ name: 'Thunderbolt', pp: 5.5, unbounded: 999 }]);
    deps.applyCollectionUpdate(actor, 'moves', { update: [{ name: 'Thunderbolt', pp: -10 }] });
    assert.equal(actor.collections.moves[0].pp, -2.5);
    deps.applyCollectionUpdate(actor, 'moves', { update: [{ name: 'Thunderbolt', pp: 1.25 }] });
    assert.equal(actor.collections.moves[0].pp, 1.25);
    deps.applyCollectionUpdate(actor, 'moves', { replace: [{ name: 'Ember' }] });
    assert.equal(actor.collections.moves[0].pp, 5.5);
    deps.applyCollectionUpdate(actor, 'moves', { update: [{ name: 'Ember', pp: '99/999' }] });
    assert.equal(actor.collections.moves[0].pp, 5.5);
});
