import test from 'node:test';
import assert from 'node:assert/strict';
import { pointCapacity, allocateRandomPoints, pointSpend, pointOptions } from '../src/tracker/level-stat-points.js';

const stats = [
    { id: 'hp', name: 'HP', type: 'number', defaultValue: '10/10' },
    { id: 'atk', name: 'ATK', type: 'number', defaultValue: '', maxStatValue: '255', locked: true },
    { id: 'xp', name: 'XP', type: 'number', defaultValue: '0/20' },
];
const config = { xpFieldId: 'xp', levelFieldId: 'level', statIds: ['hp', 'atk'] };

test('HP grows capacity while ratings saved with denominators respect their fixed caps', () => {
    assert.equal(pointCapacity(stats[0], '6/10', 20), 20);
    assert.equal(pointCapacity({ ...stats[0], maxStatValue: '15' }, '6/10', 20), 5);
    assert.equal(pointCapacity({ ...stats[0], maxStatValue: '10' }, '6/10', 20), 0);
    assert.equal(pointCapacity(stats[1], '254/255', 20), 1);
    assert.equal(pointCapacity(stats[1], '255', 20), 0);
    assert.equal(pointCapacity(stats[1], '', 20), 0);
    assert.equal(pointCapacity(stats[1], 'bad', 20), 0);
});

test('random allocation picks with replacement and redistributes as stats hit their caps', () => {
    const options = pointOptions(stats, config, { HP: '6/10', ATK: '254/255' }, 20);
    assert.deepEqual(allocateRandomPoints(options, 20, () => .99), { atk: 1, hp: 19 });
    assert.deepEqual(allocateRandomPoints(options, 20, () => 0), { hp: 20 });
    assert.equal(options.find(option => option.id === 'atk').capacity, 1, 'Allocation must not mutate the options');
    assert.deepEqual(allocateRandomPoints([{ id: 'atk', capacity: 1 }], 20), { atk: 1 });
});

test('manual allocations cannot exceed their budget or choose foreign stats or fractional amounts', () => {
    const row = { grant: { points: 4, statIds: ['hp', 'atk'] } };
    const values = { HP: '6/10', ATK: '254/255', XP: '0/20' };
    for (const allocations of [{ hp: 5 }, { hp: 3, atk: 2 }, { xp: 1 }, { hp: -1 }, { hp: .5 }, []]) {
        assert.equal(pointSpend({ ...row, allocations }, stats, config, values), null);
    }
    const spend = pointSpend({ ...row, allocations: { hp: 1, atk: 3 } }, stats, config, values);
    assert.equal(spend.spent, 2, 'Caps leave unspent points instead of silently losing them');
    assert.deepEqual(spend.choices.map(choice => [choice.id, choice.gain]), [['hp', 1], ['atk', 1]]);
});
