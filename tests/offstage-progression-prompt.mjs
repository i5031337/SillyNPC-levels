import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { progressionFields } from '../src/tracker/progression-fields.js';
import { npcStatsFor } from '../src/core/npc-templates.js';
import { collectionAppliesTo } from '../src/core/collection-targets.js';
import { numericDeltaNames, configuredXpName } from '../src/tracker/extractor/status-extractor-deltas.js';
import { isTurnStat } from '../src/tracker/stat-update-policy.js';
import { readerPromptTexts } from '../src/prompts/prompt-texts-reader.js';

function load(path, deps, exported) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function ');
    return new Function(...Object.keys(deps), `${source}\nreturn ${exported};`)(...Object.values(deps));
}
const tracker = { globalStats: [], playerStats: [], npcStats: [
    { id: 'xp', name: 'Experience', type: 'number', updatePolicy: 'advancement' },
    { id: 'level', name: 'Rank', type: 'number', updatePolicy: 'advancement' },
    { id: 'power', name: 'Power', type: 'number', updatePolicy: 'advancement' },
], collections: [], npcTemplates: [{ id: 'fighter', statIds: ['xp', 'level', 'power'],
    progression: { enabled: true, xpFieldId: 'xp', levelFieldId: 'level' } }] };
const card = { name: 'Mira', npcTemplateId: 'fighter', statusOverrides: {
    Experience: '90/100', Rank: '1', Power: '5',
} };

test('schema offers known offstage Advancement experience deltas and explicit absent-actor flag', () => {
    const build = load('../src/tracker/extractor/status-extractor-schema.js', {
        progressionFields, npcStatsFor, collectionAppliesTo, numericDeltaNames, configuredXpName, isTurnStat,
        npcTemplates: () => [], goalFields: () => [],
    }, 'buildExtractionSchema');
    const schema = build(tracker, { state: { characters: [] }, cards: [card] });
    const actor = schema.properties.characters.items.properties;
    assert.equal(actor.offstage.type, 'boolean');
    assert.deepEqual(actor.deltas.properties, { Experience: { type: 'number' } });
    assert.equal(actor.stats.properties.Rank, undefined);
});

test('offstage prompt exposes earned XP and Level baseline while hiding unrelated Advancement ratings', () => {
    const describe = load('../src/tracker/extractor/status-extractor-prompt-offstage.js', {
        progressionFields, npcTemplateFor: actor => ({ id: actor.npcTemplateId }),
        charactersMentionedIn: () => [card], charactersFromActivatedLore: () => [],
        liveFactsFor: actor => ({ stats: actor.statusOverrides, collections: {} }),
        summariseCollections: () => ({}), profileBlock: () => ({}), isTurnStat,
    }, 'describeAbsentButNamed');
    const records = JSON.parse(describe({ characters: [] }, 'Mira earned experience elsewhere.', tracker));
    assert.equal(records[0].offstage, true);
    assert.deepEqual(records[0].stats, { Experience: '90/100', Rank: '1' });
    const prompt = readerPromptTexts.find(entry => entry.id === 'reader').text;
    assert.match(prompt, /"offstage": true/);
    assert.match(prompt, /Never mark an unknown NPC offstage/);
    assert.match(prompt, /complete present cast/);
});
