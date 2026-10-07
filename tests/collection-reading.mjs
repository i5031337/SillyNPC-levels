import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { collectionAppliesTo } from '../src/core/collection-targets.js';
import { readerPromptTexts } from '../src/prompts/prompt-texts-reader.js';
import { SYSTEM_PROMPT } from '../src/core/constants-prompts.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export ', '');
function fixture() {
    const settings = { statusTracker: { collections: [{ id: 'moves', name: 'Moves', target: 'player',
        fields: [{ name: 'dex', type: 'number', isPrimary: true }, { name: 'power', type: 'number' }] }] } };
    const deps = { committedState: {}, getCurrentPersonaName: () => 'Player',
        getMergedItem: (_id, item) => item, constrainToDefinition: (_field, value) => value };
    new Function('getSettings', 'collectionAppliesTo', 'debugLog', 'LOG_PREFIX',
        `${source('../src/tracker/status-collection-updates.js')}\nreturn bind;`)(
        () => settings, collectionAppliesTo, () => {}, 'test')(deps);
    return deps;
}

test('collection previews explain unknown IDs and target mismatches without changing actors', () => {
    const deps = fixture();
    const actor = { name: 'Delphie', npcTemplateId: 'pokemon', collections: {} };
    deps.applyCollectionUpdate(actor, 'Moves label', { add: [{ dex: 653 }] }, { dryRun: true });
    deps.applyCollectionUpdate(actor, 'moves', { add: [{ dex: 653 }] }, { dryRun: true });
    const warnings = deps.takeCollectionWarnings();
    assert.match(warnings[0], /Delphie.*unknown collection ID.*"moves"/);
    assert.match(warnings[1], /does not apply to NPC template "pokemon"/);
    assert.deepEqual(actor.collections, {});
    assert.deepEqual(deps.takeCollectionWarnings(), []);
});

test('changed examples show previous and new values for any configured field type', () => {
    const build = new Function(`${source('../src/tracker/extractor/status-extractor-prompt-state.js')}\nreturn buildDeltaExample;`)();
    for (const [name, type, previous, next] of [
        ['Charge', 'number', 1, 2], ['Ready', 'boolean', true, false],
        ['Detail', 'text', '<its previous value>', '<its new value>'],
    ]) {
        const examples = build({ collections: [{ id: 'entries', fields: [
            { name: 'key', type: 'text', isPrimary: true }, { name, type },
        ] }] });
        const changed = examples.split('\n\n')[2];
        assert.ok(changed.startsWith(`Changed item (${JSON.stringify(name)} changed from ${JSON.stringify(previous)} to ${JSON.stringify(next)}; report the new absolute value, not a delta)`));
        assert.equal(JSON.parse(changed.slice(changed.indexOf('\n') + 1)).entries.update[0][name], next);
    }
    for (const { text } of readerPromptTexts) {
        assert.match(text, /Fields in "update" contain the new absolute values, not amounts gained or lost/);
        assert.match(text, /Use "update" when fields of an existing entry change/);
        assert.doesNotMatch(text, /quantity|stack|remaining total/i);
    }
    assert.match(SYSTEM_PROMPT, /Collection "update" fields contain their new absolute values, not deltas/);
    assert.doesNotMatch(SYSTEM_PROMPT, /quantity|stack|remaining total/i);
});

test('missing and blank identifiers are explained for additions, updates and replacements', () => {
    for (const update of [{ add: [{ power: 5 }] }, { update: [{ dex: ' ' }] },
        { replace: [{ dex: null }] }]) {
        const deps = fixture();
        const actor = { name: 'Player', collections: {} };
        deps.applyCollectionUpdate(actor, 'moves', update, { dryRun: true });
        assert.match(deps.takeCollectionWarnings()[0], /requires primary field "dex"/);
        assert.deepEqual(actor.collections.moves, []);
    }
});

test('numeric identifiers including zero remain valid, and normal writes do not leak preview warnings', () => {
    const deps = fixture();
    const actor = { name: 'Player', collections: {} };
    deps.applyCollectionUpdate(actor, 'moves', { add: [{ dex: 0, power: 5 }] }, { dryRun: true });
    deps.applyCollectionUpdate(actor, 'moves', { update: [{ dex: 0, power: 7 }] }, { dryRun: true });
    assert.deepEqual(actor.collections.moves, [{ dex: 0, power: 7 }]);
    deps.applyCollectionUpdate(actor, 'moves', { remove: [0] }, { dryRun: true });
    assert.deepEqual(actor.collections.moves, []);
    assert.deepEqual(deps.takeCollectionWarnings(), []);
    deps.applyCollectionUpdate(actor, 'moves', { add: [{}] });
    assert.deepEqual(deps.takeCollectionWarnings(), []);
});

test('collection examples use the primary field type consistently for all operations', () => {
    const build = new Function(`${source('../src/tracker/extractor/status-extractor-prompt-state.js')}\nreturn buildDeltaExample;`)();
    for (const [type, expected] of [['number', 1],
        ['boolean', true], ['text', '<exact primary field value>']]) {
        const examples = build({ collections: [{ id: 'moves', fields: [
            { name: 'key', type, isPrimary: true }, { name: 'power', type: 'number' },
        ] }] }).split('\n\n').map(block => JSON.parse(block.slice(block.indexOf('\n') + 1)).moves);
        assert.equal(examples.length, 3);
        assert.deepEqual(Object.keys(examples[0]), ['add']);
        assert.deepEqual(Object.keys(examples[1]), ['remove']);
        assert.deepEqual(Object.keys(examples[2]), ['update']);
        assert.equal(examples[0].add[0].key, expected);
        assert.equal(examples[2].update[0].key, expected);
        assert.equal(examples[1].remove[0], expected);
        assert.equal(examples[0].add[0].power, 1);
        assert.equal(examples[2].update[0].power, 2);
    }
    const prompt = readerPromptTexts.find(entry => entry.id === 'reader').text;
    assert.match(prompt, /quoted collection ID.*never its display label/);
    assert.match(prompt, /primary field in every "add" and "update" entry/);
});
