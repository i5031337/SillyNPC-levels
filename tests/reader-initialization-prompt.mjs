import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { describeReaderStats } from '../src/tracker/stat-prompt-definitions.js';
import { promptText } from '../src/prompts/prompt-texts.js';
import { progressionFields } from '../src/tracker/progression-fields.js';
import { numericDeltaNames, progressionXpName } from '../src/tracker/extractor/status-extractor-deltas.js';
import { collectionAppliesTo } from '../src/core/collection-targets.js';

// Replace host-dependent imports while exercising the actual prompt builder.
const source = readFileSync(new URL('../src/tracker/extractor/status-extractor-prompt.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export function ', 'function ');
function builder(templates, context = { chat: [] }, personaName = 'Alex') {
    const empty = () => '';
    return new Function('npcTemplates', 'npcStatsFor', 'describeReaderStats', 'promptText',
        'describeCurrentState', 'describeAbsentButNamed', 'describeLimits', 'describeNumericDeltas',
        'progressionXpName', 'describeNpcTemplates', 'strangerValues', 'describeCollections',
        'buildDeltaExample', 'numericDeltaNames', 'isReaderStat', 'getCurrentPersonaName', 'getContext',
        'progressionFields', 'collectionAppliesTo',
        `${source}\nreturn { buildNewNpcExample, buildUserPrompt, collectLeadUp };`)(
        () => templates, (_actor, settings) => settings.npcStats || [], describeReaderStats, promptText,
        empty, empty, empty, empty, progressionXpName, empty, () => ({}), empty, empty, numericDeltaNames,
        stat => !stat.locked, () => personaName, () => context, progressionFields, collectionAppliesTo);
}

test('reader initialization includes locked field purposes, ranges and text choices', () => {
    const settings = { npcStats: [
        { name: 'Rank', type: 'number', locked: true, purpose: 'Combat ability', min: '1', maxStatValue: '10' },
        { name: 'Species', type: 'text', locked: true, options: ['Human', 'Elf'] },
    ] };
    const { buildNewNpcExample, buildUserPrompt } = builder([{ id: 'npc' }]);
    const example = JSON.parse(buildNewNpcExample(settings)).characters[0];
    assert.match(example.stats.Rank, /Combat ability.*initialize once.*min: 1; max: 10/);
    assert.match(example.stats.Species, /choose: Human, Elf.*locked afterward/);
    assert.equal(example.npcTemplateId, undefined);
    const prompt = buildUserPrompt({ characters: [] }, 'Mira enters.', settings);
    assert.match(prompt, /### NPC INITIALIZATION FIELDS/);
    assert.match(prompt, /NPC.Rank: number; Combat ability.*min: 1; max: 10/);
    assert.match(prompt, /never report deltas for them/);
});

test('multiple templates retain the selection ID in the initialization example', () => {
    const { buildNewNpcExample } = builder([{ id: 'human' }, { id: 'elf' }]);
    assert.equal(JSON.parse(buildNewNpcExample()).characters[0].npcTemplateId, 'human');
});

test('reader identifies the active player and labels history with player names', () => {
    const { buildUserPrompt, collectLeadUp } = builder([], { chat: [
        { is_user: true, name: 'Alex', mes: 'I enter.' },
        { is_user: false, mes: 'Mira greets Alex.' },
        { is_user: true, mes: 'Hello.' },
        { is_user: false, mes: 'Mira smiles.' },
    ] });
    const earlier = collectLeadUp(3, 3);
    assert.deepEqual(earlier, ['[Player (Alex)] I enter.', '[Narrator] Mira greets Alex.', '[Player (Alex)] Hello.']);
    const prompt = buildUserPrompt({ characters: [] }, 'Mira smiles.', {}, earlier);
    assert.match(prompt, /Alex is the player-controlled character\. References to Alex belong under player\./);
    assert.match(prompt, /\[Player \(Alex\)\] I enter\./);
    const renamed = builder([], { chat: [] }, 'Rhea');
    assert.match(renamed.buildUserPrompt({ characters: [] }, 'Hello.', {}), /Rhea is the player-controlled character/);
});

test('NPC example awards positive XP and excludes the automatic Level field', () => {
    const template = { id: 'fighter', statIds: ['xp', 'rank'], progression: {
        enabled: true, xpFieldId: 'xp', levelFieldId: 'rank',
    } };
    const settings = { npcTemplates: [template], npcStats: [
        { id: 'rank', name: 'Rank', type: 'number' },
        { id: 'xp', name: 'Experience', type: 'number' },
    ] };
    const state = { characters: [{ name: 'Mira', npcTemplateId: 'fighter', stats: { Rank: '2', Experience: '20/100' } }] };
    const prompt = builder([template]).buildUserPrompt(state, 'Mira wins.', settings);
    const example = JSON.parse(prompt.split('Changed-reply shape (include only changes supported by the latest message):\n')[1]);
    assert.deepEqual(example.characters[0].deltas, { Experience: 1 });
    assert.match(prompt, /Absolute readings under "stats" and "global" are JSON strings/);
    assert.match(prompt, /Numeric changes under "deltas" and "globalDeltas" are JSON numbers/);
    assert.match(prompt, /### NEW NPC REPLY EXAMPLE/);
    assert.doesNotMatch(prompt, /NPC INITIALIZATION TEMPLATE|a plain number stays a plain number/);
});

test('new NPC collection examples preserve numeric and boolean field types', () => {
    const example = JSON.parse(builder([]).buildNewNpcExample({ collections: [{ id: 'gear', target: 'npc', fields: [
        { name: 'code', isPrimary: true, type: 'number' },
        { name: 'ready', type: 'boolean' },
    ] }] }));
    assert.deepEqual(example.characters[0].collections.gear.add, [{ code: 1, ready: true }]);
});

test('current state includes filled locked readings as strings while omitting retired fields', () => {
    const stateSource = readFileSync(new URL('../src/tracker/extractor/status-extractor-prompt-state.js', import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replaceAll('export function ', 'function ');
    const settings = { npcStats: [{ name: 'Power', locked: true }, { name: 'Health' }], playerStats: [], globalStats: [] };
    const describe = new Function('statsInSystem', 'collectionAppliesTo', 'fieldsForCard', 'getPlayerCard',
        'npcTemplateFor', 'findCardForName', `${stateSource}\nreturn describeCurrentState;`)(
        (values, key) => Object.fromEntries(Object.entries(values || {}).filter(([name]) => settings[key].some(def => def.name === name))),
        () => false, () => [], () => null, () => null, () => null);
    const current = JSON.parse(describe({ global: {}, player: {}, characters: [{ name: 'Mira', stats: {
        Power: 5, Health: '8/10', Retired: 3,
    } }] }, settings));
    assert.deepEqual(current.characters[0].stats, { Power: '5', Health: '8/10' });
});
