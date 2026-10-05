import { progressionFields } from '../src/tracker/progression-fields.js';
import { npcStatsFor } from '../src/core/npc-templates.js';
import { npcTemplates } from '../src/core/npc-templates.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { numericDeltaNames, configuredXpName } from '../src/tracker/extractor/status-extractor-deltas.js';
import { isTurnStat } from '../src/tracker/stat-update-policy.js';
import { PROFILE_FIELDS, NPC_LORE_FIELDS, anyProfileFieldUnlocked } from '../src/core/constants-profile.js';
import { formatLoreContent, parseLoreContent, parseGeneratedProfileFields, mergeLoreValues } from '../src/lore/lore-format.js';
import { DEFAULT_LORE_PROMPT } from '../src/prompts/default-prompt-texts.js';
import { loreReplyWasTruncated, parseLoreReply } from '../src/lore/lore-reply.js';
import { resolveProfileFields, resolveProfileFieldsFromSystem, setProfileSettingsProvider, profileStrings } from '../src/core/profile-fields.js';

test('player profiles use player fields and preserve additional lore and memories', () => {
    const prose = '### Hero\nA traveler from the coast.\nKeeps a journal.';
    const content = formatLoreContent({ appearance: 'Red cloak' }, prose, undefined, 'player');
    assert.equal(content.includes('Role:'), false);
    assert.match(content, /### Additional lore\nA traveler from the coast\.\nKeeps a journal\.$/);
    assert.equal(parseLoreContent(content, { scope: 'player' }).appearance, 'Red cloak');
    const updated = formatLoreContent({ appearance: 'Blue cloak' }, content,
        { entries: [{ id: 'm1', text: 'Visited the docks.' }] }, 'player');
    assert.equal(updated.split('### Additional lore').length, 2);
    assert.match(updated, /### Memories\n- Visited the docks\.$/);
    assert.equal(mergeLoreValues(updated, { age: '28' }, 'player').appearance, 'Blue cloak');
    assert.equal(parseLoreContent('Appearance: Red cloak', { scope: 'player' }).appearance, 'Red cloak');
});

test('custom player profile fields never use the NPC schema', () => {
    setProfileSettingsProvider(() => ({ activeSystem: 'Custom', statusTracker: { presets: {
        Custom: { definition: { profiles: { player: [{ id: 'origin', label: 'Origin' }],
            npc: [{ id: 'role', label: 'Role' }] } } },
    } } }));
    try {
        const content = formatLoreContent({ origin: 'Coast' }, '', undefined, 'player');
        assert.equal(content, 'Origin: Coast');
        assert.deepEqual(parseLoreContent(content, { scope: 'player' }), { origin: 'Coast' });
        assert.deepEqual(mergeLoreValues(content, { origin: 'Hills' }, 'player'), { origin: 'Hills' });
    } finally { setProfileSettingsProvider(() => null); }
});

test('active System fields replace defaults while retired fields stay on cards', () => {
    const system = { profiles: { npc: [
        { id: 'calling', label: 'Calling', guidance: 'Their calling', policy: 'anchored' },
        { id: 'old', label: 'Old', retired: true },
    ], player: [] } };
    assert.deepEqual(resolveProfileFieldsFromSystem(system, 'npc').map(field => field.id), ['calling']);
    setProfileSettingsProvider(() => ({ activeSystem: 'Custom', statusTracker: { presets: { Custom: { definition: system } } } }));
    try {
        const content = formatLoreContent({ calling: 'Scout', old: 'preserved elsewhere' });
        assert.equal(content, 'Calling: Scout');
        assert.deepEqual(parseLoreContent(content), { calling: 'Scout' });
        const legacy = NPC_LORE_FIELDS.map(field => `${field.label}: legacy ${field.id}`).join('\n');
        assert.equal(parseLoreContent(legacy).age, 'legacy age');
        const merged = mergeLoreValues(legacy, { retiredNote: 'Keep this' });
        assert.equal(merged.age, 'legacy age');
        assert.equal(merged.retiredNote, 'Keep this');
        const synced = formatLoreContent({ ...merged, calling: 'Scout' }, legacy);
        assert.equal(synced.split('\n')[0], 'Calling: Scout');
        assert.ok(synced.includes('Age: legacy age'));
        assert.equal(parseLoreContent(synced).age, 'legacy age');
        const oldCustom = 'Former calling: Ranger';
        assert.deepEqual(parseLoreContent(oldCustom), {});
        const renamed = formatLoreContent({ calling: 'Scout' }, oldCustom);
        assert.equal(renamed, 'Calling: Scout\nFormer calling: Ranger');
        assert.deepEqual(parseLoreContent(renamed), { calling: 'Scout' });
        assert.deepEqual(profileStrings({ calling: ' Scout ', retiredNote: 'Keep this', invalid: 4 }),
            { calling: 'Scout', retiredNote: 'Keep this' });
        assert.equal(resolveProfileFields('player').length, 0);
    } finally {
        setProfileSettingsProvider(() => null);
    }
});

test('every NPC lore field has one ordered line and round trips', () => {
    const values = { age: '34', role: 'Watchmaker', history: 'Moved here last spring.' };
    const content = formatLoreContent(values);
    assert.equal(content.split('\n').length, NPC_LORE_FIELDS.length);
    assert.deepEqual(parseLoreContent(`### Mira\n${content}`), {
        ...Object.fromEntries(NPC_LORE_FIELDS.map(field => [field.id, ''])), ...values,
    });
    assert.equal(mergeLoreValues(content, { role: 'Master watchmaker' }).role, 'Master watchmaker');
});

test('lore includes active sourced memories and keeps profile parsing intact', () => {
    const saved = formatLoreContent({ role: 'Watchmaker' }, '', {
        entries: [{ id: 'm1', text: 'Mira repaired the clock.', sourceMessageId: '7' }],
        archive: [{ id: 'm2', text: 'Old event', sourceMessageId: '2' }],
    });
    assert.match(saved, /### Memories\n- Mira repaired the clock\.$/);
    assert.ok(!saved.includes('Old event'));
    assert.equal(parseLoreContent(saved).role, 'Watchmaker');
    assert.equal(formatLoreContent({ role: 'Clockmaker' }, saved).split('### Memories')[1],
        saved.split('### Memories')[1]);
    assert.equal(formatLoreContent({ role: 'Clockmaker' }, saved, { entries: [], archive: [] })
        .includes('### Memories'), false);
});

test('malformed or free-form NPC lore is rejected', () => {
    assert.equal(parseLoreContent('Role: Watchmaker\nHistory: Moved here.'), null);
    assert.equal(parseLoreContent(`${formatLoreContent({})}\nExtra prose`), null);
    assert.equal(parseLoreContent(formatLoreContent({}).replace('Age:', 'Years')), null);
});

test('a lore generation may provide only supported fields before storage normalizes it', () => {
    const partial = 'Role: Watchmaker\nHistory: Moved here.';
    assert.deepEqual(parseLoreContent(partial, { allowPartial: true }),
        { role: 'Watchmaker', history: 'Moved here.' });
    assert.deepEqual(parseLoreContent(`### Mira\n${partial}`, { allowPartial: true }),
        { role: 'Watchmaker', history: 'Moved here.' });
    assert.deepEqual(parseGeneratedProfileFields('### Hero\nAppearance: Red cloak', 'player'),
        { appearance: 'Red cloak' });
    assert.equal(parseLoreContent(formatLoreContent(parseLoreContent(partial, { allowPartial: true }))).role,
        'Watchmaker');
    assert.equal(parseLoreContent('History: Moved here.\nRole: Watchmaker', { allowPartial: true }), null);
    assert.deepEqual(parseLoreContent('Role: Watchmaker\nUnknown: text', { allowPartial: true }),
        { role: 'Watchmaker' });
});

test('compact lore keeps only supplied active fields, including previously empty ones', () => {
    const reply = 'Tags: Professor Sycamore, Sycamore\n'
        + 'Content: Role: Kalos professor. Wants: New trainers prepared. '
        + 'Method: Gives equipment. Limits: Cannot accompany trainers. '
        + 'Ties: Knows Serena’s mother. History: Runs the Lumiose lab.';
    const { content, followedSections } = parseLoreReply(reply);
    assert.equal(followedSections, true);
    assert.deepEqual(parseGeneratedProfileFields(content, 'npc'), {
        role: 'Kalos professor.', wants: 'New trainers prepared.',
        ties: 'Knows Serena’s mother.', history: 'Runs the Lumiose lab.',
    });
    assert.deepEqual(parseGeneratedProfileFields('Role: Professor Wants: Help trainers', 'npc'),
        { role: 'Professor', wants: 'Help trainers' });
    const system = { profiles: { npc: [
        { id: 'role', label: 'Role' }, { id: 'method', label: 'Method' },
        { id: 'limits', label: 'Limits' },
    ] } };
    setProfileSettingsProvider(() => ({ activeSystem: 'Custom', statusTracker: { presets: { Custom: { definition: system } } } }));
    try {
        assert.deepEqual(parseGeneratedProfileFields('Role: Professor. Method: Advises. Limits: Cannot travel.', 'npc'),
            { role: 'Professor.', method: 'Advises.', limits: 'Cannot travel.' });
    } finally {
        setProfileSettingsProvider(() => null);
    }
});

test('saving partial lore records supported NPC and player fields', async () => {
    const source = readFileSync(new URL('../src/api/api-lore-generate.js', import.meta.url), 'utf8');
    const saveSource = source.slice(source.indexOf('export async function saveLoreContent'))
        .replace('export async function', 'async function');
    const entries = { 0: { uid: 0, content: '', key: [] } };
    let saved = 0;
    const saveLoreContent = new Function('loadWorldInfo', 'saveWorldInfo', 'parseLoreContent',
        'parseGeneratedProfileFields', 'mergeLoreValues', 'formatLoreContent', 'syncEntryIdentity',
        'mergeKeywords', 'saveSettings', 'profileFieldsForCard', `${saveSource}\nreturn saveLoreContent;`)(
        async () => ({ entries }), async () => { saved++; }, parseLoreContent,
        parseGeneratedProfileFields, mergeLoreValues, formatLoreContent, () => {},
        (old, tags) => [...old, tags], () => {}, card => resolveProfileFields(card.isPlayer ? 'player' : 'npc'),
    );
    const npc = { name: 'Mira', profile: { role: '' } };
    const npcSaved = await saveLoreContent(npc, 'World', 0, 'Mira', 'Role: Watchmaker\nHistory: Moved here.');
    assert.equal(npcSaved.profileFieldsSaved, 2);
    assert.equal(npc.profile.role, 'Watchmaker');
    assert.equal(parseLoreContent(entries[0].content).history, 'Moved here.');
    assert.equal(Object.hasOwn(npc.profile, 'age'), false);
    await saveLoreContent(npc, 'World', 0, 'Mira',
        'Role: Watchmaker. Wants: Repair clocks. Method: Uses tiny tools. History: Moved here.');
    assert.equal(npc.profile.wants, 'Repair clocks.');
    assert.equal(Object.hasOwn(npc.profile, 'method'), false);
    assert.equal(Object.hasOwn(npc.profile, 'age'), false);
    const player = { name: 'Hero', isPlayer: true, profile: { appearance: '' } };
    const playerSaved = await saveLoreContent(player, 'World', 0, 'Hero', 'Appearance: Red cloak');
    assert.equal(playerSaved.profileFieldsSaved, 1);
    assert.equal(player.profile.appearance, 'Red cloak');
    assert.equal(entries[0].content, formatLoreContent({ appearance: 'Red cloak' }, '', undefined, 'player'));
    assert.equal(saved, 3);
    await assert.rejects(saveLoreContent(npc, 'World', 0, '', 'Unknown: Lost detail'),
        /named fields/);
    assert.equal(saved, 3);
});

test('empty generated fields preserve existing lore and profile values', async () => {
    const source = readFileSync(new URL('../src/api/api-lore-generate.js', import.meta.url), 'utf8');
    const saveSource = source.slice(source.indexOf('export async function saveLoreContent'))
        .replace('export async function', 'async function');
    const entries = { 0: { uid: 0, content: formatLoreContent({ role: 'Professor', wants: 'Help trainers' }), key: [] } };
    const saveLoreContent = new Function('loadWorldInfo', 'saveWorldInfo', 'parseLoreContent',
        'parseGeneratedProfileFields', 'mergeLoreValues', 'formatLoreContent', 'syncEntryIdentity',
        'mergeKeywords', 'saveSettings', 'profileFieldsForCard', `${saveSource}\nreturn saveLoreContent;`)(
        async () => ({ entries }), async () => {}, parseLoreContent,
        parseGeneratedProfileFields, mergeLoreValues, formatLoreContent, () => {},
        (old, tags) => [...old, tags], () => {}, card => resolveProfileFields(card.isPlayer ? 'player' : 'npc'),
    );
    const npc = { name: 'Sycamore', profile: { role: 'Professor', wants: 'Help trainers' } };
    const saved = await saveLoreContent(npc, 'World', 0, '', 'Role: \nWants: Prepare trainers',
        { preserveEmpty: true });
    assert.equal(saved.profileFieldsSaved, 1);
    assert.equal(npc.profile.role, 'Professor');
    assert.equal(npc.profile.wants, 'Prepare trainers');
    assert.equal(parseLoreContent(entries[0].content).role, 'Professor');
    const player = { name: 'Hero', isPlayer: true, profile: { appearance: 'Red cloak' } };
    entries[0].content = 'Appearance: Red cloak\nPersonality: Bold';
    await saveLoreContent(player, 'World', 0, '', 'Appearance: \nPersonality: Patient',
        { preserveEmpty: true });
    assert.equal(player.profile.appearance, 'Red cloak');
    assert.equal(entries[0].content, formatLoreContent({ appearance: 'Red cloak', personality: 'Patient' }, '', undefined, 'player'));
});

test('lore truncation uses provider finish reason when available', () => {
    assert.equal(loreReplyWasTruncated({ choices: [{ finish_reason: 'length' }] }), true);
    assert.equal(loreReplyWasTruncated({ choices: [{ native_finish_reason: 'max_tokens' }] }), true);
    assert.equal(loreReplyWasTruncated({ choices: [{ finish_reason: 'stop' }] }), false);
    assert.equal(loreReplyWasTruncated({ choices: [{ text: 'Role: Professor' }] }), false);
});

test('the default lore prompt allows unsupported fields to be omitted', () => {
    assert.match(DEFAULT_LORE_PROMPT, /Omit fields with no supported value/);
    assert.match(DEFAULT_LORE_PROMPT, /tags: {{name}}\ncontent: \|\n{{profileTemplate}}$/);
    assert.equal((DEFAULT_LORE_PROMPT.match(/content: \|/g) || []).length, 1);
    assert.doesNotMatch(DEFAULT_LORE_PROMPT, /every named field|fill if known/i);
});

test('lore reply accepts plain labels and a fenced YAML wrapper', () => {
    assert.deepEqual(parseLoreReply('Tags: Mira, Captain Mira\nContent:\nRole: Watchmaker'), {
        tags: 'Mira, Captain Mira', content: 'Role: Watchmaker', followedSections: true,
    });
    assert.deepEqual(parseLoreReply('tags: Mira\ncontent: |\n  Role: Watchmaker'), {
        tags: 'Mira', content: 'Role: Watchmaker', followedSections: true,
    });
    const yaml = '```yaml\ntags:\n  - Mira\n  - Captain Mira\ncontent: |\n  Role: Watchmaker\n  History: Moved here.\n```';
    const parsed = parseLoreReply(yaml);
    assert.equal(parsed.tags, 'Mira, Captain Mira');
    assert.equal(parsed.content, 'Role: Watchmaker\nHistory: Moved here.');
    assert.deepEqual(parseLoreContent(parsed.content, { allowPartial: true }), {
        role: 'Watchmaker', history: 'Moved here.',
    });
    assert.equal(parseLoreReply('tags: [Mira]\ncontent:\n  Role: Watchmaker\n  History: Moved here.').content,
        'Role: Watchmaker\nHistory: Moved here.');
    const lowerCase = parseLoreReply('tags: [Mira]\ncontent:\n  history: Moved here.\n  role: Watchmaker',
        resolveProfileFields('npc'));
    assert.equal(lowerCase.content, 'Role: Watchmaker\nHistory: Moved here.');
    assert.equal(parseLoreReply('Unrelated prose').followedSections, false);
});

test('tracker schema excludes lore fields and retains tracked stats', () => {
    const source = readFileSync(new URL('../src/tracker/extractor/status-extractor-schema.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replaceAll('export function ', 'function ');
    const npc = { name: 'Mira', aiProfileFields: ['appearance'] };
    const player = { name: 'Hero', isPlayer: true, aiProfileFields: ['appearance'] };
    const build = new Function('npcTemplates', 'getAllCharacters', 'getPlayerCard', 'resolveProfileFields',
        'anyProfileFieldUnlocked', 'numericDeltaNames', 'configuredXpName', 'isTurnStat', 'progressionFields', 'npcStatsFor',
        `${source}\nreturn buildExtractionSchema;`)(
        npcTemplates, () => [npc], () => player, resolveProfileFields, anyProfileFieldUnlocked,
        numericDeltaNames, configuredXpName, isTurnStat, progressionFields, npcStatsFor,
    );
    const schema = build({ globalStats: [], playerStats: [], npcStats: [], collections: [] });
    assert.equal(schema.properties.characters.items.properties.profile, undefined);
    assert.equal(schema.properties.characters.items.properties.memories, undefined);
    assert.equal(schema.properties.player.properties.profile, undefined);
    assert.equal(schema.properties.player.properties.memories, undefined);
    assert.equal(schema.properties.player.properties.goals, undefined);
    assert.equal(schema.properties.characters.items.properties.goals, undefined);

    const withDeltas = build({
        globalStats: [], playerStats: [{ name: 'HP' }], npcStats: [], collections: [],
        extractionReasons: false,
    }, { state: { player: { stats: { HP: '7/10' } }, characters: [] } });
    assert.equal(withDeltas.properties.player.properties.deltas.properties.HP.type, 'number');

    const xpSchema = build({
        globalStats: [], playerStats: [{ name: 'XP', type: 'number', defaultValue: '0/100' }, { name: 'Level', type: 'number', defaultValue: '1' }], npcStats: [], collections: [],
    }, { state: { player: { stats: { XP: '90/100', Level: '1' } }, characters: [] } });
    assert.equal(xpSchema.properties.player.properties.stats.properties.XP, undefined);
    assert.equal(xpSchema.properties.player.properties.deltas.properties.XP.type, 'number');
    const blankXpSchema = build({
        globalStats: [], playerStats: [{ name: 'XP', type: 'number', defaultValue: '0/100' }, { name: 'Level', type: 'number', defaultValue: '1' }], npcStats: [], collections: [],
    }, { state: { player: { stats: { XP: '', Level: '1' } }, characters: [] } });
    assert.equal(blankXpSchema.properties.player.properties.stats.properties.XP, undefined);
});

test('Fill requests missing named fields in one generation call', async () => {
    const source = readFileSync(new URL('../src/characters/character-fill-lore.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replaceAll('export async function ', 'async function ');
    let calls = 0;
    const entry = formatLoreContent({ role: 'Watchmaker' });
    const fillLore = new Function('loadWorldInfo', 'debugLog', 'getSettings', 'saveSettings',
        'createLoreEntry', 'generateLoreContent', 'saveLoreContent',
        'tryAutoSyncLorebook', 'getChatLorebookName', 'profileFieldsForCard', 'parseLoreContent',
        'parseGeneratedProfileFields',
        `${source}\nreturn fillLore;`)(
        async () => ({ entries: { 0: { content: entry } } }),
        () => {}, () => ({ defaultLorebook: 'World' }), () => {},
        () => { throw new Error('should reuse linked entry'); },
        async () => { calls++; return { content: formatLoreContent({ age: '34', role: 'Watchmaker' }), tags: '' }; },
        async () => {}, () => false, () => 'World', card => resolveProfileFields(card.isPlayer ? 'player' : 'npc'), parseLoreContent,
        parseGeneratedProfileFields,
    );
    const char = { name: 'Mira', profile: {}, lorebook: { world: 'World', uid: 0 } };
    assert.equal((await fillLore(char)).ok, true);
    assert.equal(calls, 1);
});
