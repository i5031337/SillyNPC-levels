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

test('advancement ratings have a fixed configured range', () => {
    const def = { type: 'number', updatePolicy: 'advancement', min: '1', maxStatValue: '5' };
    assert.equal(configuredNumericMaximum(def), 5);
    assert.equal(constrainNumericStat(def, '9', '4'), '5');
    assert.equal(constrainNumericStat(def, '-2', '4'), '1');
    assert.equal(constrainNumericStat(def, '4/9', '3/5'), '4/5');
});

test('ordinary model readings retain the actor’s maximum', () => {
    assert.equal(keepNumericMaximum('4/100', '20'), '4/20');
    assert.equal(keepNumericMaximum('4', '20'), '4/20');
    assert.equal(keepNumericMaximum('4/100', ''), '4');
});
