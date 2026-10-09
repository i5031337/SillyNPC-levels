import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { collectionQuantityField, ensureCollectionQuantity } from '../src/core/collection-fields.js';
import { collectionAppliesTo } from '../src/core/collection-targets.js';
import { normalizeSystemDefinition } from '../src/core/system-schema.js';

function load(path, dependencies, name) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '');
    return new Function(...Object.keys(dependencies), `${source}\nreturn ${name};`)(...Object.values(dependencies));
}
function fixture({ counted = true, primary = 'name', quantity = 'quantity' } = {}) {
    const col = { id: 'items', name: 'Items', targets: ['player', 'npc'], trackQuantity: counted,
        fields: [{ name: primary, type: 'text', isPrimary: true },
            ...(counted ? [{ name: quantity, type: 'number', defaultValue: '1' }] : []),
            { name: 'condition', type: 'text', defaultValue: '' }] };
    const settings = { collections: [col] };
    const deps = { committedState: {}, getCurrentPersonaName: () => 'Player',
        constrainToDefinition: (_field, value) => value, getMergedItem: (_id, item) => item };
    load('../src/tracker/status-collection-updates.js', { collectionQuantityField, collectionAppliesTo,
        getSettings: () => ({ statusTracker: settings }), debugLog() {}, LOG_PREFIX: '[test]' }, 'bind')(deps);
    const actor = { name: 'Player', collections: {} };
    const apply = update => deps.applyCollectionUpdate(actor, 'items', update, { dryRun: true });
    return { deps, actor, apply, col, settings };
}

test('gains accumulate equal amounts, default to one, and consumption removes only the spent quantity', () => {
    const { actor, apply } = fixture();
    apply({ add: [{ name: 'Potion', quantity: 2, condition: 'Fresh' }] });
    apply({ add: [{ name: 'Potion', quantity: 2 }] });
    assert.equal(actor.collections.items[0].quantity, 4);
    apply({ add: [{ name: 'Potion' }] });
    assert.equal(actor.collections.items[0].quantity, 5);
    apply({ remove: [{ name: 'Potion', quantity: 2 }] });
    assert.deepEqual(actor.collections.items, [{ name: 'Potion', quantity: 3, condition: 'Fresh' }]);
    apply({ remove: ['Potion'] });
    assert.equal(actor.collections.items[0].quantity, 2);
    apply({ remove: [{ name: 'Potion' }] });
    assert.equal(actor.collections.items[0].quantity, 1);
    apply({ remove: [{ name: 'Potion', quantity: 1 }] });
    assert.deepEqual(actor.collections.items, []);
});

test('whole-stack removal is explicit and overspending removes at zero', () => {
    for (const removal of [{ name: 'Potion', all: true }, { name: 'Potion', quantity: 99 }]) {
        const { actor, apply } = fixture();
        apply({ add: [{ name: 'Potion', quantity: 4 }] });
        apply({ remove: [removal] });
        assert.deepEqual(actor.collections.items, []);
    }
});

test('invalid quantities leave holdings intact and produce review diagnostics', () => {
    const { actor, apply, deps } = fixture();
    apply({ add: [{ name: 'Potion', quantity: 4 }] });
    for (const amount of [0, -1, '2', Infinity, NaN]) {
        apply({ add: [{ name: 'Potion', quantity: amount }] });
        apply({ remove: [{ name: 'Potion', quantity: amount }] });
    }
    assert.equal(actor.collections.items[0].quantity, 4);
    assert.ok(deps.takeCollectionWarnings().every(message => /positive quantity/.test(message)));
});

test('updates change other fields, while history and accepted review replacements retain absolute quantities', () => {
    const { actor, apply } = fixture();
    apply({ add: [{ name: 'Potion', quantity: 4 }] });
    apply({ update: [{ name: 'Potion', quantity: 1, condition: 'Opened' }] });
    assert.deepEqual(actor.collections.items, [{ name: 'Potion', quantity: 4, condition: 'Opened' }]);
    apply({ replace: [{ name: 'Potion', quantity: 2, condition: 'Opened' }] });
    assert.equal(actor.collections.items[0].quantity, 2);
});

test('uncounted collections retain set membership semantics', () => {
    const { actor, apply } = fixture({ counted: false });
    apply({ add: [{ name: 'Fireball' }] });
    apply({ add: [{ name: 'Fireball' }] });
    apply({ update: [{ name: 'Fireball', condition: 'Mastered' }] });
    assert.deepEqual(actor.collections.items, [{ name: 'Fireball', condition: 'Mastered' }]);
    apply({ remove: ['Fireball'] });
    assert.deepEqual(actor.collections.items, []);
});

test('custom identifiers, legacy quantity keys and transfers keep quantities owned by each actor', () => {
    const { actor, apply, deps } = fixture({ primary: 'code', quantity: 'qty' });
    apply({ add: [{ code: 'Potion', qty: 4 }] });
    const npc = { name: 'Mira', collections: {} };
    apply({ remove: [{ code: 'Potion', qty: 2 }] });
    deps.applyCollectionUpdate(npc, 'items', { add: [{ code: 'Potion', qty: 2 }] }, { dryRun: true });
    assert.equal(actor.collections.items[0].qty, 2);
    assert.equal(npc.collections.items[0].qty, 2);
    assert.deepEqual(deps.committedState, {});
});

test('quantity settings infer existing counted fields, preserve keys, and round-trip built-in defaults', () => {
    const normalize = collection => normalizeSystemDefinition({ collections: [collection] }).collections[0];
    const legacy = normalize({ id: 'items', fields: [{ name: 'name', isPrimary: true }, { name: 'qty', type: 'number' }] });
    assert.equal(legacy.trackQuantity, true);
    assert.equal(collectionQuantityField(legacy).name, 'qty');
    const fresh = normalize({ id: 'items', trackQuantity: true, fields: [{ name: 'name', isPrimary: true }] });
    assert.equal(collectionQuantityField(fresh).defaultValue, '1');
    assert.deepEqual(normalize(fresh), fresh);
    assert.equal(ensureCollectionQuantity(fresh), false);
    const uncounted = normalize({ id: 'skills', fields: [{ name: 'name', isPrimary: true }] });
    assert.equal(uncounted.trackQuantity, false);
});

test('reader schema and examples show amounts for removals and reserve update for other fields', () => {
    const { settings, col } = fixture();
    const dependencies = { collectionQuantityField, collectionAppliesTo, progressionFields: () => null,
        npcStatsFor: () => [], npcTemplates: () => [], poolTags: () => [], strangerKind: () => '',
        numericDeltaNames: () => [], configuredXpName: () => null, isReaderStat: () => true };
    const schema = load('../src/tracker/extractor/status-extractor-schema.js', dependencies, 'buildExtractionSchema')(settings);
    const operations = schema.properties.player.properties.collections.properties.items.properties;
    assert.equal(operations.remove.items.type, 'object');
    assert.deepEqual(operations.remove.items.required, ['name']);
    assert.equal(operations.remove.items.properties.quantity.type, 'number');
    assert.equal(operations.remove.items.properties.all.type, 'boolean');
    assert.equal(operations.update.items.properties.quantity, undefined);
    const examples = load('../src/tracker/extractor/status-extractor-prompt-state.js', { collectionQuantityField }, 'buildDeltaExample')({ collections: [col] });
    const changes = examples.split('\n\n').map(block => JSON.parse(block.slice(block.indexOf('\n') + 1)).items);
    assert.deepEqual(changes[1], { remove: [{ name: '<exact primary field value>', quantity: 1 }] });
    assert.deepEqual(changes[2], { remove: [{ name: '<exact primary field value>', all: true }] });
    assert.deepEqual(changes[3], { update: [{ name: '<exact primary field value>', condition: '<new value>' }] });
});

test('accepting a partial-consumption review writes the absolute remainder once', () => {
    const { actor, apply, settings } = fixture();
    apply({ add: [{ name: 'Potion', quantity: 4 }] });
    const before = { player: structuredClone(actor), characters: [] };
    apply({ remove: [{ name: 'Potion', quantity: 1 }] });
    const build = load('../src/tracker/status-diff-review.js', {
        primaryFieldName: col => col.fields.find(field => field.isPrimary)?.name || 'name',
        itemKey: (item, primary) => String(item[primary]).toLowerCase(), debugLog() {},
    }, 'buildUpdateFromChanges');
    const accepted = build([{ kind: 'item-change', scope: 'player', collectionId: 'items',
        item: { name: 'Potion' }, field: 'quantity', before: 4, after: 3 }], before, settings);
    assert.deepEqual(accepted.player.collections.items, { replace: [{ name: 'Potion', quantity: 3, condition: '' }] });
    actor.collections = structuredClone(before.player.collections);
    apply(accepted.player.collections.items);
    assert.equal(actor.collections.items[0].quantity, 3);
});
