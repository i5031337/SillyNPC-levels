import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { describeReaderStats } from '../src/tracker/stat-prompt-definitions.js';
import { promptText } from '../src/prompts/prompt-texts.js';
import { progressionFields } from '../src/tracker/progression-fields.js';
import { numericDeltaNames, progressionXpName } from '../src/tracker/extractor/status-extractor-deltas.js';
import { collectionAppliesTo } from '../src/core/collection-targets.js';
import { SYSTEM_PROMPT } from '../src/core/constants-prompts.js';
import { defaultPromptText, PROMPT_TEXTS } from '../src/prompts/prompt-texts.js';

// Replace host-dependent imports while exercising the actual prompt builder.
const source = readFileSync(new URL('../src/tracker/extractor/status-extractor-prompt.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export function ', 'function ');
function builder(templates, context = { chat: [] }, personaName = 'Alex', descriptions = {}) {
    const empty = () => '';
    return new Function('npcTemplates', 'npcStatsFor', 'describeReaderStats', 'promptText',
        'describeCurrentState', 'describeAbsentButNamed', 'describeLimits', 'describeNumericDeltas',
        'progressionXpName', 'describeNpcTemplates', 'strangerValues', 'describeCollections',
        'buildDeltaExample', 'numericDeltaNames', 'isReaderStat', 'getCurrentPersonaName', 'getContext',
        'progressionFields', 'collectionAppliesTo',
        `${source}\nreturn { buildNewNpcExample, buildUserPrompt, collectLeadUp };`)(
        () => templates, (_actor, settings) => settings.npcStats || [], describeReaderStats, promptText,
        descriptions.state || empty, empty, empty, descriptions.numericDeltas || empty,
        progressionXpName, empty, () => ({}), descriptions.collections || empty, empty, numericDeltaNames,
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

test('battle reader permits prose-derived damage and records demonstrated abilities for existing NPCs', () => {
    const settings = { npcStats: [
        { name: 'HP', type: 'bar', defaultValue: '10/10', purpose: 'Health remaining' },
        { name: 'ATK', type: 'number', locked: true },
    ], collections: [{ id: 'moves', name: 'Moves', target: 'npc', fields: [
        { name: 'Name', type: 'text', isPrimary: true },
    ] }] };
    const state = { characters: [
        { name: 'Mudkip', stats: { HP: '10/10', ATK: '5' }, collections: { moves: [{ Name: 'Water Gun' }] } },
        { name: 'Poochyena', stats: { HP: '10/10', ATK: '5' }, collections: { moves: [] } },
    ] };
    const message = 'Mudkip uses Water Gun. Poochyena yelps as the hit knocks him back, '
        + 'then uses Tackle, painfully knocking Mudkip onto the grass.';
    const prompt = builder([], { chat: [] }, 'Redd', {
        state: value => JSON.stringify(value),
        numericDeltas: () => 'Mudkip: HP\nPoochyena: HP',
        collections: () => '- "moves" (Moves) for NPCs. Fields: Name [identifies the item]',
    }).buildUserPrompt(state, message, settings);
    assert.ok(prompt.includes(message));
    assert.match(prompt, /Missing numbers do not mean an established effect should be ignored/);
    assert.match(prompt, /estimate a conservative amount using the field's current scale/);
    assert.match(prompt, /"characters\[\]\.deltas"/);
    assert.match(prompt, /no explicit learning announcement is needed, even for an already tracked actor/);
    assert.match(prompt, /Keep reusable entries after use/);
    assert.match(prompt, /A command or mere mention alone does not prove/);
    assert.match(prompt, /Do not create collections or duplicate entries already held/);
    assert.match(prompt, /Preserve established pool maxima and filled locked stats/);
    assert.match(prompt, /when estimating an amount, briefly identify.*estimated/);
});

test('system and inline prompts share general inference and ability discovery guidance', () => {
    assert.match(SYSTEM_PROMPT, /narrator need not state field names, numbers/);
    assert.match(SYSTEM_PROMPT, /estimate a conservative amount/);
    assert.match(SYSTEM_PROMPT, /add it to the applicable configured collection if missing/);
    assert.match(SYSTEM_PROMPT, /Never remove a reusable entry merely because it was used/);
    const inline = promptText('storyBlock', { status: '{}', rules: '', schemas: 'Configured ability collection' });
    assert.match(inline, /explicit field names and numbers are unnecessary/);
    assert.match(inline, /Plans, requests, and unresolved attempts do not establish their intended outcomes/);
    assert.match(inline, /No explicit learning announcement is needed/);
    assert.match(inline, /Keep reusable entries after use/);
    for (const text of [SYSTEM_PROMPT, defaultPromptText('reader'), defaultPromptText('storyBlock')]) {
        assert.doesNotMatch(text, /pok[eé]mon|Mudkip|Poochyena|Water Gun|Tackle/i);
    }
});

test('tracker prompts use configured fields without assuming an active stat or mechanic', () => {
    const settings = { npcStats: [{ name: 'Focus', type: 'number', purpose: 'Concentration remaining' }] };
    const state = { characters: [{ name: 'Mira', stats: { Focus: '10' } }] };
    const reader = builder([]).buildUserPrompt(state, 'Mira completes a demanding task.', settings);
    const inline = promptText('storyBlock', { status: '{}', rules: '', statDefinitions: 'NPC.Focus: number' });
    for (const text of [SYSTEM_PROMPT, reader, inline, defaultPromptText('scanSystem')]) {
        assert.doesNotMatch(text, /\bhealth\b|\bhp\b|\bmana\b|\bcondition\b|\binjur(?:y|ies)\b|\breputation\b|\brelationship\b|public-standing|\bHealthy\b/i);
    }
    assert.match(reader, /Use only configured stats and collections/);
    assert.match(reader, /Follow configured persistence and reset rules/);
    assert.doesNotMatch(reader, /### EXPERIENCE|WHEN A COLLECTION CHANGES/);
    assert.doesNotMatch(inline, /Experience:|### COLLECTIONS/);
    assert.match(SYSTEM_PROMPT, /When progression is enabled for an owner/);
    assert.match(defaultPromptText('scanSystem'), /Follow each collection's configured purpose and rules/);
    assert.doesNotMatch(defaultPromptText('scanSystem'), /An abstract fact is not a skill/);
});

test('built-in model prompts do not assume dice mechanics', () => {
    for (const text of [SYSTEM_PROMPT, ...PROMPT_TEXTS.map(entry => entry.text)]) {
        assert.doesNotMatch(text, /\bdice\b|\broll(?:s|ed)?\b|\bd\d+\b|saving throw|skill check/i);
    }
    assert.match(SYSTEM_PROMPT, /Apply an announced cost when the action actually incurs it/);
    assert.match(SYSTEM_PROMPT, /A plan or request alone does not establish payment/);
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
