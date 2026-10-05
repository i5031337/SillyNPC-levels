import { progressionFields } from '../src/tracker/progression-fields.js';
import { npcStatsFor, npcTemplateFor, proposedNpcTemplate } from '../src/core/npc-templates.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { configuredNumericMaximum, constrainNumericStat, keepNumericMaximum, isPoolStat } from '../src/tracker/numeric-stat-bounds.js';
import { isReaderStat } from '../src/tracker/stat-update-policy.js';
import { expandNumericDeltas } from '../src/tracker/extractor/status-extractor-deltas.js';

// The browser-facing module is loaded with only the dependencies this path uses.
const source = readFileSync(new URL('../src/tracker/status-stat-values.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replace('export function bind', 'function bind');
const bind = new Function('npcStatsFor', 'proposedNpcTemplate', 'keepNumericMaximum', 'configuredNumericMaximum',
    'isReaderStat', 'progressionFields', 'isPoolStat',
    'ceilingFromValue', 'splitValue',
    `${source}\nreturn bind;`)(npcStatsFor, proposedNpcTemplate, keepNumericMaximum, configuredNumericMaximum,
    isReaderStat, progressionFields, isPoolStat,
    value => { const cap = String(value ?? '').split('/')[1]; return cap && Number.isFinite(Number(cap)) ? Number(cap) : null; },
    value => { const [current, max] = String(value ?? '').split('/'); return { current, max }; });

test('ordinary model updates keep existing and starting maxima across actors', () => {
    const deps = {
        findMatchingStatKey: (stats, name) => Object.keys(stats || {}).find(k => k.toLowerCase() === name.toLowerCase()),
        findCardForName: () => null,
    };
    bind(deps);
    const settings = {
        globalStats: [],
        playerStats: [{ name: 'HP', type: 'number' }, { name: 'XP', type: 'number' }],
        npcStats: [{ name: 'HP', type: 'number', maxStatValue: '10' }],
    };
    const state = { global: {}, player: { stats: { HP: '6/20', XP: '90/100' } },
        characters: [{ name: 'Mira', stats: { HP: '' } }] };
    const update = { player: { stats: { HP: '4/50', XP: '110/200', HP_max: '50' } },
        characters: [{ name: 'Mira', stats: { HP: '7/40' } }, { name: 'Jon', HP: '3/70' }] };
    deps.sanitizeModelUpdate(update, state, settings);
    assert.deepEqual(update.player.stats, { HP: '4/20', XP: '110/100' });
    assert.deepEqual(update.characters[0].stats, { HP: '7/10' });
    assert.equal(update.characters[1].HP, '3/10');
});

test('a fixed rating range starts as a plain rating', () => {
    const deps = {};
    bind(deps);
    assert.equal(deps.getInitialStatValue('1', '5', { locked: true }), '1');
    assert.equal(deps.getInitialStatValue('1', '5', {}), '1');
});

test('inline updates cannot author level-derived locked growth', () => {
    const deps = { findMatchingStatKey: (stats, name) => Object.keys(stats || {})
        .find(key => key.toLowerCase() === name.toLowerCase()), findCardForName: () => null };
    bind(deps);
    const skill = { name: 'Swordplay', type: 'number', locked: true,
        maxStatValue: '5', advanceOnLevel: true };
    const settings = { globalStats: [], npcStats: [], playerStats: [
        { name: 'XP', type: 'number' }, { name: 'Level', type: 'number' }, skill,
    ] };
    const state = { global: {}, characters: [], player: { stats: {
        XP: '90/100', Level: '1', Swordplay: '4',
    } } };
    const update = { player: { stats: { XP: '110/100', Swordplay: '8/9' } } };
    deps.sanitizeModelUpdate(update, state, settings, { allowInlineLevelBonus: true });
    assert.equal(update.player.stats.Swordplay, undefined);
    assert.equal(update.player.stats.XP, '110/100');
});

test('Standing deltas on plain ratings stay within configured bounds across scopes', () => {
    const deps = { findMatchingStatKey: (stats, name) => Object.keys(stats || {})
        .find(key => key.toLowerCase() === name.toLowerCase()), findCardForName: () => null };
    bind(deps);
    const standing = { name: 'Standing', type: 'number', min: '-5', maxStatValue: '5' };
    const settings = { globalStats: [standing], playerStats: [standing], npcStats: [standing] };
    const state = { global: { Standing: '4' }, player: { stats: { Standing: '-4' } },
        characters: [{ name: 'Mira', stats: { Standing: '5' } }] };
    const update = { globalDeltas: { Standing: 3 }, player: { deltas: { Standing: -3 } },
        characters: [{ name: 'Mira', deltas: { standing: 1 } }] };
    expandNumericDeltas(update, state, settings);
    deps.sanitizeModelUpdate(update, state, settings);
    const apply = (incoming, existing) => constrainNumericStat(standing,
        deps.mergeStatValue(existing, incoming), existing);
    assert.equal(apply(update.global.Standing, state.global.Standing), '5');
    assert.equal(apply(update.player.Standing, state.player.stats.Standing), '-5');
    assert.equal(apply(update.characters[0].Standing, state.characters[0].stats.Standing), '5');
    assert.equal(deps.promptCeiling(standing, '5'), '5');
    assert.equal(deps.promptCeiling(standing, '7/10'), '10');
});

test('enabled NPC XP remains writable while configured Level fragments are reserved', () => {
    const deps = { findMatchingStatKey: (stats, name) => Object.keys(stats || {})
        .find(key => key.toLowerCase() === name.toLowerCase()), findCardForName: () => null };
    bind(deps);
    const settings = { globalStats: [], playerStats: [], npcStats: [
        { id: 'earned', name: 'Experience', type: 'number' },
        { id: 'rank', name: 'Rank', type: 'number', },
    ], npcTemplates: [{ id: 'fighter', statIds: ['earned', 'rank'], progression: {
        enabled: true, xpFieldId: 'earned', levelFieldId: 'rank',
    } }] };
    const state = { characters: [{ name: 'Mira', npcTemplateId: 'fighter',
        stats: { Experience: '90/100', Rank: '1' } }] };
    const update = { characters: [{ name: 'Mira', stats: {
        Experience: '110/999', Rank: '99', Rank_current: '99', Rank_max: '100',
    } }] };
    deps.sanitizeModelUpdate(update, state, settings);
    assert.deepEqual(update.characters[0].stats, { Experience: '110/100' });
});


test('a configured pool accepts slash readings over a previously plain value', () => {
    const deps = { findMatchingStatKey: (stats, name) => Object.keys(stats || {})
        .find(key => key.toLowerCase() === name.toLowerCase()), findCardForName: () => null };
    bind(deps);
    const hp = { name: 'HP', type: 'number', defaultValue: '15/15', maxStatValue: '30' };
    const settings = { globalStats: [hp], playerStats: [hp], npcStats: [hp] };
    const state = { global: { HP: '15' }, player: { stats: { HP: '15' } },
        characters: [{ name: 'Mira', stats: { HP: '15' } }] };
    const update = { global: { HP: '12/15' }, player: { stats: { HP: '12/15' } },
        characters: [{ name: 'Mira', stats: { HP: '12/15' } }] };
    deps.sanitizeModelUpdate(update, state, settings);
    assert.equal(constrainNumericStat(hp, update.player.stats.HP, '15'), '12/15');
    assert.equal(update.global.HP, '12/15');
    assert.equal(update.player.stats.HP, '12/15');
    assert.equal(update.characters[0].stats.HP, '12/15');
    assert.equal(deps.promptCeiling(hp, '15'), '15');
    assert.equal(deps.promptCeiling(hp, '12/18'), '18');
    const bare = { player: { stats: { HP: '10' } } };
    deps.sanitizeModelUpdate(bare, state, settings);
    assert.equal(bare.player.stats.HP, '10/15');
});

test('NPC initialization accepts individual pools and blank locked Level once', () => {
    const deps = { findMatchingStatKey: (stats, name) => Object.keys(stats || {})
        .find(key => key.toLowerCase() === name.toLowerCase()), findCardForName: () => null };
    bind(deps);
    const hp = { id: 'hp', name: 'HP', type: 'number', defaultValue: '10/10' };
    const level = { id: 'level', name: 'Level', type: 'number', defaultValue: '', locked: true };
    const xp = { id: 'xp', name: 'XP', type: 'number', defaultValue: '0/20' };
    const settings = { globalStats: [], playerStats: [], npcStats: [hp, level, xp],
        npcTemplates: [{ id: 'pokemon', statIds: ['hp', 'level', 'xp'], progression: {
            enabled: true, xpFieldId: 'xp', levelFieldId: 'level', statGrowth: 'none', statIds: [],
        } }] };
    const state = { characters: [] };
    const update = { characters: [
        { name: 'Flarit', npcTemplateId: 'pokemon', stats: { HP: '5/5', Level: 1, XP: 0 } },
        { name: 'Other', npcTemplateId: 'pokemon', stats: { HP: 8, Level: '3' } },
    ] };
    deps.sanitizeModelUpdate(update, state, settings);
    assert.equal(update.characters[0].stats.HP, '5/5');
    assert.equal(update.characters[0].stats.Level, '1');
    assert.equal(update.characters[0].stats.XP, '0/20');
    assert.equal(update.characters[1].stats.HP, '8/8');
    assert.equal(update.characters[1].stats.Level, '3');
    assert.equal(constrainNumericStat(hp, update.characters[0].stats.HP, hp.defaultValue), '5/5');
    state.characters = [{ name: 'Flarit', npcTemplateId: 'pokemon', stats: { HP: '5/5', Level: '1', XP: '0/20' } }];
    const later = { characters: [{ name: 'Flarit', stats: { HP: '4/10', Level: 2, Level_current: 2 } }] };
    deps.sanitizeModelUpdate(later, state, settings);
    assert.deepEqual(later.characters[0].stats, { HP: '4/5' });
    for (const invalid of [0, -1, 1.5, 'nonsense']) {
        const bad = { characters: [{ name: 'Other', npcTemplateId: 'pokemon', stats: { Level: invalid } }] };
        deps.sanitizeModelUpdate(bad, { characters: [] }, settings);
        assert.equal(bad.characters[0].stats.Level, undefined);
    }
});
