import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { constrainNumericStat } from '../src/tracker/numeric-stat-bounds.js';
import { expandNumericDeltas } from '../src/tracker/extractor/status-extractor-deltas.js';

const source = readFileSync(new URL('../src/tracker/status-update-constraints.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export function bind', 'function bind');
const deps = {};
new Function('debugLog', 'constrainNumericStat', `${source}\nreturn bind;`)(() => {}, constrainNumericStat)(deps);

test('definition refusals and adjustments explain the reason and retained value', () => {
    for (const [def, incoming, existing, expected, reason] of [
        [{ name: 'Mood', options: ['Happy'] }, 'Tense', 'Happy', 'Happy', /allowed values are Happy/],
        [{ name: 'HP', type: 'number' }, 'nonsense', '5', '5', /valid numeric reading/],
        [{ name: 'HP', type: 'number', min: '2' }, '0', '5', '2', /numeric bounds/],
        [{ name: 'Mood' }, '<new value>', 'Happy', 'Happy', /prompt placeholder/],
        [{ name: 'Note', maxLength: 4 }, 'abcdefgh', 'old', 'abcd…', /character limit/],
    ]) {
        const warnings = [];
        assert.equal(deps.constrainToDefinition(def, incoming, existing, warning => warnings.push(warning)), expected);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], reason);
        assert.ok(warnings[0].includes(expected));
    }
    const warnings = [];
    deps.constrainToDefinition({ type: 'number' }, '3', '5', line => warnings.push(line));
    assert.deepEqual(warnings, []);
});

test('each rejected delta and absolute XP has an explanation while valid deltas survive', () => {
    const settings = { globalStats: [], npcStats: [], playerStats: [
        { name: 'XP', purpose: 'xp', type: 'number' }, { name: 'Level', purpose: 'level', type: 'number' },
        { name: 'Power', locked: true }, { name: 'HP', type: 'number' },
        { name: 'Blank' }, { name: 'Huge' },
    ] };
    const state = { player: { stats: { XP: '10/100', Level: '1', Power: '2', HP: '5', Huge: '1' } } };
    const update = { player: { stats: { XP: '20', HP: '4' },
        deltas: { XP: -2, Level: 1, Power: 2, HP: -1, Missing: 1, Blank: 1, Huge: 1e30 } } };
    const warnings = [];
    expandNumericDeltas(update, state, settings, { warnings });
    assert.equal(warnings.length, 8);
    for (const reason of ['positive delta', 'progression', 'locked', 'absolute value', 'no configured stat',
        'no numeric current value', 'too large']) assert.ok(warnings.some(line => line.includes(reason)), reason);
    assert.ok(warnings.every(line => line.startsWith('Player ·')));
    assert.deepEqual(update.player.stats, { HP: '4' });
    const accepted = { player: { deltas: { XP: 2, HP: -1 } } };
    const clean = [];
    expandNumericDeltas(accepted, state, settings, { warnings: clean });
    assert.deepEqual(clean, []);
    assert.equal(accepted.player.XP, '12/100');
    assert.equal(accepted.player.HP, '4');
});
