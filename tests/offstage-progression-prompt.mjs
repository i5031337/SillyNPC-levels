import { collectionQuantityField } from '../src/core/collection-fields.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { progressionFields } from '../src/tracker/progression-fields.js';
import { npcStatsFor } from '../src/core/npc-templates.js';
import { collectionAppliesTo } from '../src/core/collection-targets.js';
import { numericDeltaNames, configuredXpName } from '../src/tracker/extractor/status-extractor-deltas.js';
import { isReaderStat } from '../src/tracker/stat-update-policy.js';
import { readerPromptTexts } from '../src/prompts/prompt-texts-reader.js';

function load(path, deps, exported) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ') + `\n${collectionQuantityField.toString()}\n`;
    return new Function(...Object.keys(deps), `${source}\nreturn ${exported};`)(...Object.values(deps));
}
const tracker = { globalStats: [], playerStats: [], npcStats: [
    { id: 'xp', name: 'Experience', type: 'number' },
    { id: 'level', name: 'Rank', type: 'number', locked: true },
    { id: 'power', name: 'Power', type: 'number', locked: true },
], collections: [], npcTemplates: [{ id: 'fighter', statIds: ['xp', 'level', 'power'],
    progression: { enabled: true, xpFieldId: 'xp', levelFieldId: 'level' } }] };
const card = { name: 'Mira', npcTemplateId: 'fighter', statusOverrides: {
    Experience: '90/100', Rank: '1', Power: '5',
} };

test('schema offers known offstage experience deltas and explicit absent-actor flag', () => {
    const build = load('../src/tracker/extractor/status-extractor-schema.js', {
        progressionFields, npcStatsFor, collectionAppliesTo, numericDeltaNames, configuredXpName, isReaderStat,
        npcTemplates: () => [],
    }, 'buildExtractionSchema');
    const schema = build(tracker, { state: { characters: [] }, cards: [card] });
    const actor = schema.properties.characters.items.properties;
    assert.equal(actor.offstage.type, 'boolean');
    assert.deepEqual(actor.deltas.properties, { Experience: { type: 'number' } });
    assert.equal(actor.stats.properties.Rank.type, 'string'); // Blank locked NPC stats can be initialized.
});

test('offstage prompt exposes filled locked stats as initialization reference data', () => {
    const describe = load('../src/tracker/extractor/status-extractor-prompt-offstage.js', {
        progressionFields, npcTemplateFor: actor => ({ id: actor.npcTemplateId }),
        charactersMentionedIn: () => [card], charactersFromActivatedLore: () => [],
        liveFactsFor: actor => ({ stats: actor.statusOverrides, collections: {} }),
        summariseCollections: () => ({}), profileBlock: () => ({}), isReaderStat,
    }, 'describeAbsentButNamed');
    const records = JSON.parse(describe({ characters: [] }, 'Mira earned experience elsewhere.', tracker));
    assert.equal(records[0].offstage, true);
    assert.deepEqual(records[0].stats, { Experience: '90/100', Rank: '1', Power: '5' });
    const prompt = readerPromptTexts.find(entry => entry.id === 'reader').text;
    assert.match(prompt, /"offstage": true/);
    assert.match(prompt, /Never mark an unknown NPC offstage/);
    assert.match(prompt, /complete present cast/);
});

test('collection removal schema uses the configured primary field type', () => {
    const build = load('../src/tracker/extractor/status-extractor-schema.js', {
        progressionFields, npcStatsFor, collectionAppliesTo, numericDeltaNames, configuredXpName, isReaderStat,
        npcTemplates: () => [],
    }, 'buildExtractionSchema');
    for (const type of ['number', 'boolean', 'text']) {
        const schema = build({ ...tracker, collections: [{ id: 'gear', target: 'player', fields: [
            { name: 'code', type, isPrimary: true },
        ] }] });
        const collection = schema.properties.player.properties.collections.properties.gear.properties;
        const expected = type === 'text' ? 'string' : type;
        assert.equal(collection.remove.items.type, expected);
        assert.equal(collection.add.items.properties.code.type, expected);
        assert.equal(collection.update.items.properties.code.type, expected);
    }
});
