import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { numericDeltaNames } from '../src/tracker/extractor/status-extractor-deltas.js';
import { isTurnStat } from '../src/tracker/stat-update-policy.js';
import { PROFILE_FIELDS, NPC_LORE_FIELDS, anyProfileFieldUnlocked } from '../src/core/constants-profile.js';
import { formatLoreContent, parseLoreContent, mergeLoreValues } from '../src/lore/lore-format.js';
import { DEFAULT_LORE_PROMPT } from '../src/prompts/default-prompt-texts.js';
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

test('the default Fill prompt names the complete field order', () => {
    const prompt = DEFAULT_LORE_PROMPT;
    const format = prompt.slice(prompt.lastIndexOf('Content:\n') + 'Content:\n'.length);
    const labels = format.split('\n').map(line => line.slice(0, line.indexOf(':')));
    assert.deepEqual(labels, NPC_LORE_FIELDS.map(field => field.label));
    for (const field of NPC_LORE_FIELDS) {
        assert.ok(prompt.includes(`- ${field.label}: ${field.hint}`));
    }
});

test('tracker schema follows System policies rather than old per-card unlocks', () => {
    const source = readFileSync(new URL('../src/tracker/extractor/status-extractor-schema.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replaceAll('export function ', 'function ');
    const npc = { name: 'Mira', aiProfileFields: ['appearance'] };
    const player = { name: 'Hero', isPlayer: true, aiProfileFields: ['appearance'] };
    const build = new Function('getAllCharacters', 'getPlayerCard', 'resolveProfileFields',
        'anyProfileFieldUnlocked', 'numericDeltaNames', 'isTurnStat', 'goalFields',
        `${source}\nreturn buildExtractionSchema;`)(
        () => [npc], () => player, resolveProfileFields, anyProfileFieldUnlocked,
        numericDeltaNames, isTurnStat, scope => scope === 'player'
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
        `${source}\nreturn fillLore;`)(
        async () => ({ entries: { 0: { content: entry } } }),
        () => {}, () => ({ defaultLorebook: 'World' }), () => {},
        () => { throw new Error('should reuse linked entry'); },
        async () => { calls++; return { content: formatLoreContent({ age: '34', role: 'Watchmaker' }), tags: '' }; },
        async () => {}, () => false, () => 'World', resolveProfileFields, parseLoreContent,
    );
    const char = { name: 'Mira', profile: {}, lorebook: { world: 'World', uid: 0 } };
    assert.equal((await fillLore(char)).ok, true);
    assert.equal(calls, 1);
});
