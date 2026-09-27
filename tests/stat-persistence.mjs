import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseNpcPersistence, splitNpcStats, initialiseNpcStats,
    canTrackerSetNpcStat } from '../src/tracker/stat-persistence.js';

test('legacy custom fields require review without changing stored values', () => {
    const definitions = [{ name: 'HP', defaultValue: '10/10' }, { name: 'Wisdom', defaultValue: '4' }];
    const values = { HP: '2/10', Wisdom: '8' };
    normaliseNpcPersistence(definitions);
    assert.equal(definitions[0].persistence, 'variable');
    assert.equal(definitions[0].persistenceReview, undefined);
    assert.equal(definitions[1].persistence, 'variable');
    assert.equal(definitions[1].persistenceReview, true);
    assert.deepEqual(values, { HP: '2/10', Wisdom: '8' });
});

test('transfer carries only destination innate fields and resets adventure fields', () => {
    const destination = [
        { name: 'HP', persistence: 'variable', defaultValue: '12/12' },
        { name: 'Wisdom', persistence: 'innate', defaultValue: '3' },
        { name: 'Level', persistence: 'variable', defaultValue: '1' },
    ];
    const mixedLegacyValues = { hp: '2/10', WISDOM: '8', Level: '7', Unknown: 'secret' };
    assert.deepEqual(splitNpcStats(mixedLegacyValues, destination), {
        innate: { Wisdom: '8' }, variable: { HP: '2/10', Level: '7' },
    });
    assert.deepEqual(initialiseNpcStats(mixedLegacyValues, destination), {
        HP: '12/12', Wisdom: '8', Level: '1',
    });
});

test('the tracker may initialize blank innate stats but cannot change filled ones', () => {
    const innate = { name: 'Wisdom', persistence: 'innate' };
    const variable = { name: 'HP', persistence: 'variable' };
    assert.equal(canTrackerSetNpcStat(innate, '', undefined), true);
    assert.equal(canTrackerSetNpcStat(innate, '6', undefined), false);
    assert.equal(canTrackerSetNpcStat(innate, '', '6'), false);
    assert.equal(canTrackerSetNpcStat(variable, '2/10', '2/10'), true);
});
