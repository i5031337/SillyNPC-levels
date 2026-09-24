import assert from 'node:assert/strict';
import test from 'node:test';
import { progressXp, boostStat } from '../src/progression.js';

test('XP below the cap leaves level alone', () => {
    assert.deepEqual(progressXp('40/100', '65/100', '1'), {
        xp: '65/100', level: '1', levelsGained: 0,
    });
});

test('reaching the cap levels up and resets XP', () => {
    assert.deepEqual(progressXp('90/100', '100/100', '1'), {
        xp: '0/100', level: '2', levelsGained: 1,
    });
});

test('excess XP carries over through multiple levels', () => {
    assert.deepEqual(progressXp('90/100', '250/100', '1'), {
        xp: '50/100', level: '3', levelsGained: 2,
    });
});

test('invalid or uncapped values do not trigger progression', () => {
    assert.equal(progressXp('20/100', 'unknown', '1'), null);
    assert.equal(progressXp('20', '100', '1'), null);
    assert.equal(progressXp('20/100', '', '1'), null);
});

test('bonus raises live maximum while preserving a proposed current value', () => {
    assert.equal(boostStat('15/20', '10', 2), '12/22');
    assert.equal(boostStat('15/20', undefined, 2), '17/22');
    assert.equal(boostStat('10', undefined, 2), '12');
});
