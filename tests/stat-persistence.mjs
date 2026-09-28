import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseNpcPersistence, splitNpcStats, initialiseNpcStats,
    canTrackerSetNpcStat } from '../src/tracker/stat-persistence.js';
import { normaliseStatUpdatePolicies, canAdvanceStat, holdLevelBonusChanges,
    earnsLevel } from '../src/tracker/stat-update-policy.js';

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

test('NPC transfer persistence and turn update authority are independent', () => {
    const innate = { name: 'Wisdom', persistence: 'innate' };
    const variable = { name: 'HP', persistence: 'variable' };
    normaliseStatUpdatePolicies({ npcStats: [innate, variable], playerStats: [] });
    assert.equal(innate.updatePolicy, 'advancement');
    assert.equal(canTrackerSetNpcStat(innate, '', undefined), false);
    assert.equal(canTrackerSetNpcStat(innate, '6', undefined), false);
    assert.equal(canTrackerSetNpcStat(variable, '2/10', '2/10'), true);
    innate.updatePolicy = 'turn';
    assert.equal(canTrackerSetNpcStat(innate, '6', '6'), true);
});

test('existing numeric player fields keep level-up eligibility separately from turn policy', () => {
    const tracker = { playerStats: [
        { name: 'Strength', defaultValue: '5' },
        { name: 'XP', defaultValue: '0/100' },
        { name: 'Level', defaultValue: '1' },
        { name: 'Level Bonus', defaultValue: '' },
    ], npcStats: [] };
    normaliseStatUpdatePolicies(tracker);
    assert.equal(tracker.playerStats[0].updatePolicy, 'turn');
    assert.equal(canAdvanceStat(tracker.playerStats[0]), true);
    assert.equal(canAdvanceStat(tracker.playerStats[1]), false);
    assert.equal(tracker.playerStats[2].updatePolicy, 'advancement');
    assert.equal(tracker.playerStats[3].updatePolicy, 'advancement');
});

test('a level-up bonus waits for review while XP and Level apply', () => {
    const auto = [
        { scope: 'player', label: 'XP' },
        { scope: 'player', label: 'Level' },
        { scope: 'player', label: 'Strength' },
        { scope: 'player', label: 'Level Bonus' },
    ];
    const pending = [];
    holdLevelBonusChanges(auto, pending, { stat: 'Strength', bonusName: 'Level Bonus' });
    assert.deepEqual(auto.map(change => change.label), ['XP', 'Level']);
    assert.deepEqual(pending.map(change => change.label).sort(), ['Level Bonus', 'Strength']);
});

test('inline bonuses require an XP update that actually crosses the cap', () => {
    const state = { player: { stats: { XP: '90/100', Level: '1' } } };
    assert.equal(earnsLevel({ player: { stats: { XP: '110/100' } } }, state), true);
    assert.equal(earnsLevel({ player: { stats: { XP: '95/100' } } }, state), false);
    assert.equal(earnsLevel({ player: { stats: { 'Level Bonus': 'Power' } } }, state), false);
});
