import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredNumericMaximum, constrainNumericStat, keepNumericMaximum } from '../src/tracker/numeric-stat-bounds.js';

test('numeric readings honor the configured minimum and the live pool maximum', () => {
    const def = { type: 'number', min: '2', options: ['5'] };
    assert.equal(constrainNumericStat(def, '1/10', '7/10'), '2/10');
    assert.equal(constrainNumericStat(def, '15/10', '7/10'), '10/10');
    assert.equal(constrainNumericStat(def, '4/10', '7/10'), '4/10');
    assert.equal(constrainNumericStat(def, 'nonsense', '7/10'), '7/10');
    assert.equal(constrainNumericStat(def, '3/1', '7/10'), '7/10');
    assert.equal(constrainNumericStat(def, '-4', '7'), '2');
});

test('plain ratings have a fixed configured range', () => {
    const def = { type: 'number', locked: true, min: '1', maxStatValue: '5' };
    assert.equal(configuredNumericMaximum(def), 5);
    assert.equal(constrainNumericStat(def, '9', '4'), '5');
    assert.equal(constrainNumericStat(def, '-2', '4'), '1');
    assert.equal(constrainNumericStat(def, '4/9', '3'), '4/5');
});

test('ordinary model readings retain the actor’s maximum', () => {
    assert.equal(keepNumericMaximum('4/100', '20'), '4/20');
    assert.equal(keepNumericMaximum('4', '20'), '4/20');
    assert.equal(keepNumericMaximum('4/100', ''), '4');
});

test('plain numeric ratings honor Starts max without becoming pools', () => {
    const standing = { name: 'Standing', type: 'number', min: '-5', maxStatValue: '5' };
    assert.equal(constrainNumericStat(standing, '6', '5'), '5');
    assert.equal(constrainNumericStat(standing, '-6', '-5'), '-5');
    assert.equal(constrainNumericStat(standing, '3', '2'), '3');
    assert.equal(constrainNumericStat(standing, '12', '9'), '5');
    assert.equal(constrainNumericStat({ ...standing, type: 'bar' }, '6', '5'), '5');
    assert.equal(constrainNumericStat({ ...standing, maxStatValue: '' }, '6', '5'), '6');
    assert.equal(constrainNumericStat({ ...standing, maxStatValue: '', defaultValue: '0/5' }, '6', '5'), '5');
});

test('a live numeric pool maximum takes precedence over Starts max', () => {
    const energy = { type: 'number', maxStatValue: '100' };
    assert.equal(constrainNumericStat(energy, '115/120', '110/120'), '115/120');
    assert.equal(constrainNumericStat(energy, '125', '110/120'), '120');
    assert.equal(constrainNumericStat(energy, '125/120', '110/120'), '120/120');
});
