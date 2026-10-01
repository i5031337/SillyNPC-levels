import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { configuredNumericMaximum, constrainNumericStat, keepNumericMaximum } from '../src/tracker/numeric-stat-bounds.js';
import { isTurnStat, canAdvanceStat, earnsLevel } from '../src/tracker/stat-update-policy.js';
import { canTrackerSetNpcStat } from '../src/tracker/stat-persistence.js';

// The browser-facing module is loaded with only the dependencies this path uses.
const source = readFileSync(new URL('../src/tracker/status-stat-values.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replace('export function bind', 'function bind');
const bind = new Function('keepNumericMaximum', 'configuredNumericMaximum',
    'isTurnStat', 'canAdvanceStat', 'earnsLevel',
    'canTrackerSetNpcStat', 'ceilingFromValue', 'splitValue',
    `${source}\nreturn bind;`)(keepNumericMaximum, configuredNumericMaximum,
    isTurnStat, canAdvanceStat, earnsLevel,
    canTrackerSetNpcStat,
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

test('a fixed Advancement range starts as a plain rating', () => {
    const deps = {};
    bind(deps);
    assert.equal(deps.getInitialStatValue('1', '5', { updatePolicy: 'advancement' }), '1');
    assert.equal(deps.getInitialStatValue('1', '5', { updatePolicy: 'turn' }), '1/5');
});

test('an inline level-up cannot expand an Advancement maximum', () => {
    const deps = { findMatchingStatKey: (stats, name) => Object.keys(stats || {})
        .find(key => key.toLowerCase() === name.toLowerCase()), findCardForName: () => null };
    bind(deps);
    const skill = { name: 'Swordplay', type: 'number', updatePolicy: 'advancement',
        maxStatValue: '5', advanceOnLevel: true };
    const settings = { globalStats: [], npcStats: [], playerStats: [
        { name: 'XP', type: 'number' }, { name: 'Level', type: 'number' }, skill,
    ] };
    const state = { global: {}, characters: [], player: { stats: {
        XP: '90/100', Level: '1', Swordplay: '4',
    } } };
    const update = { player: { stats: { XP: '110/100', Swordplay: '8/9' } } };
    deps.sanitizeModelUpdate(update, state, settings, { allowInlineLevelBonus: true });
    assert.equal(update.player.stats.Swordplay, '8');
    assert.equal(constrainNumericStat(skill, update.player.stats.Swordplay, '4'), '5');
});
