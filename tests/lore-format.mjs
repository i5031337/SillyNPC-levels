import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { numericDeltaNames, configuredXpName } from '../src/tracker/extractor/status-extractor-deltas.js';
import { isTurnStat } from '../src/tracker/stat-update-policy.js';
import { PROFILE_FIELDS, NPC_LORE_FIELDS, anyProfileFieldUnlocked } from '../src/core/constants-profile.js';
import { formatLoreContent, parseLoreContent, parseGeneratedProfileFields, mergeLoreValues } from '../src/lore/lore-format.js';
import { DEFAULT_LORE_PROMPT } from '../src/prompts/default-prompt-texts.js';
import { parseLoreReply } from '../src/lore/lore-reply.js';
import { resolveProfileFields, resolveProfileFieldsFromSystem, setProfileSettingsProvider, profileStrings } from '../src/core/profile-fields.js';

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
    assert.equal(parseLoreContent('Role: Watchmaker\nUnknown: text', { allowPartial: true }), null);
});

test('saving partial lore records supported NPC and player fields', async () => {
    const source = readFileSync(new URL('../src/api/api-lore-generate.js', import.meta.url), 'utf8');
    const saveSource = source.slice(source.indexOf('export async function saveLoreContent'))
        .replace('export async function', 'async function');
    const entries = { 0: { uid: 0, content: '', key: [] } };
    let saved = 0;
    const saveLoreContent = new Function('loadWorldInfo', 'saveWorldInfo', 'parseLoreContent',
        'parseGeneratedProfileFields', 'mergeLoreValues', 'formatLoreContent', 'syncEntryIdentity',
        'mergeKeywords', 'saveSettings', 'resolveProfileFields', `${saveSource}\nreturn saveLoreContent;`)(
        async () => ({ entries }), async () => { saved++; }, parseLoreContent,
        parseGeneratedProfileFields, mergeLoreValues, formatLoreContent, () => {},
        (old, tags) => [...old, tags], () => {}, resolveProfileFields,
    );
    const npc = { name: 'Mira', profile: { role: '' } };
    const npcSaved = await saveLoreContent(npc, 'World', 0, 'Mira', 'Role: Watchmaker\nHistory: Moved here.');
    assert.equal(npcSaved.profileFieldsSaved, 2);
    assert.equal(npc.profile.role, 'Watchmaker');
    assert.equal(parseLoreContent(entries[0].content).history, 'Moved here.');
    const player = { name: 'Hero', isPlayer: true, profile: { appearance: '' } };
    const playerSaved = await saveLoreContent(player, 'World', 0, 'Hero', 'Appearance: Red cloak');
    assert.equal(playerSaved.profileFieldsSaved, 1);
    assert.equal(player.profile.appearance, 'Red cloak');
    assert.equal(entries[0].content, 'Appearance: Red cloak');
    assert.equal(saved, 2);
    await assert.rejects(saveLoreContent(npc, 'World', 0, '', 'Unknown: Lost detail'),
        /named fields/);
    assert.equal(saved, 2);
});

test('the default lore prompt allows unsupported fields to be omitted', () => {
    assert.match(DEFAULT_LORE_PROMPT, /Omit fields with no supported value/);
    assert.match(DEFAULT_LORE_PROMPT, /{{profileFields}}/);
    assert.match(DEFAULT_LORE_PROMPT, /YAML shape/);
    assert.match(DEFAULT_LORE_PROMPT, /tags: {{name}}\ncontent: \|$/);
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

test('tracker schema follows System policies rather than old per-card unlocks', () => {
    const source = readFileSync(new URL('../src/tracker/extractor/status-extractor-schema.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replaceAll('export function ', 'function ');
    const npc = { name: 'Mira', aiProfileFields: ['appearance'] };
    const player = { name: 'Hero', isPlayer: true, aiProfileFields: ['appearance'] };
    const build = new Function('getAllCharacters', 'getPlayerCard', 'resolveProfileFields',
        'anyProfileFieldUnlocked', 'numericDeltaNames', 'configuredXpName', 'isTurnStat', 'goalFields',
        `${source}\nreturn buildExtractionSchema;`)(
        () => [npc], () => player, resolveProfileFields, anyProfileFieldUnlocked,
        numericDeltaNames, configuredXpName, isTurnStat, scope => scope === 'player'
            ? [{ id: 'shortTerm', label: 'Short-term goal' }, { id: 'longTerm', label: 'Long-term goal' }]
            : [{ id: 'shortTerm', label: 'Short-term goal' }],
    );
    const schema = build({ globalStats: [], playerStats: [], npcStats: [], collections: [] });
    assert.ok(schema.properties.characters.items.properties.profile.properties.role);
    assert.equal(schema.properties.player.properties.profile.properties.role, undefined);
    assert.equal(schema.properties.characters.items.properties.profile.properties.appearance, undefined);
    assert.ok(schema.properties.characters.items.properties.profileEvidence.properties.role);
    assert.ok(schema.properties.player.properties.goals.properties.longTerm);
    assert.ok(schema.properties.characters.items.properties.goals.properties.shortTerm);
    assert.equal(schema.properties.characters.items.properties.goals.properties.longTerm, undefined);
    assert.equal(schema.properties.threads, undefined);

    const withDeltas = build({
        globalStats: [], playerStats: [{ name: 'HP' }], npcStats: [], collections: [],
        extractionReasons: false,
    }, { state: { player: { stats: { HP: '7/10' } }, characters: [] } });
    assert.equal(withDeltas.properties.player.properties.deltas.properties.HP.type, 'number');

    const xpSchema = build({
        globalStats: [], playerStats: [{ name: 'XP' }, { name: 'Level' }], npcStats: [], collections: [],
    }, { state: { player: { stats: { XP: '90/100', Level: '1' } }, characters: [] } });
    assert.equal(xpSchema.properties.player.properties.stats.properties.XP, undefined);
    assert.equal(xpSchema.properties.player.properties.deltas.properties.XP.type, 'number');
    const blankXpSchema = build({
        globalStats: [], playerStats: [{ name: 'XP' }, { name: 'Level' }], npcStats: [], collections: [],
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
        'tryAutoSyncLorebook', 'getChatLorebookName', 'resolveProfileFields', 'parseLoreContent',
        'parseGeneratedProfileFields',
        `${source}\nreturn fillLore;`)(
        async () => ({ entries: { 0: { content: entry } } }),
        () => {}, () => ({ defaultLorebook: 'World' }), () => {},
        () => { throw new Error('should reuse linked entry'); },
        async () => { calls++; return { content: formatLoreContent({ age: '34', role: 'Watchmaker' }), tags: '' }; },
        async () => {}, () => false, () => 'World', resolveProfileFields, parseLoreContent,
        parseGeneratedProfileFields,
    );
    const char = { name: 'Mira', profile: {}, lorebook: { world: 'World', uid: 0 } };
    assert.equal((await fillLore(char)).ok, true);
    assert.equal(calls, 1);
});
