import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseNpcPersistence, splitNpcStats, initialiseNpcStats,
    canTrackerSetNpcStat } from '../src/tracker/stat-persistence.js';
import { normaliseStatUpdatePolicies, canAdvanceStat, holdLevelBonusChanges,
    earnsLevel } from '../src/tracker/stat-update-policy.js';

test('numeric Advancement bonuses require a fixed maximum', () => {
    const rating = { name: 'Swordplay', type: 'number', updatePolicy: 'advancement',
        advanceOnLevel: true };
    assert.equal(canAdvanceStat(rating), false);
    assert.equal(canAdvanceStat({ ...rating, maxStatValue: '5' }), true);
    assert.equal(canAdvanceStat({ ...rating, updatePolicy: 'turn' }), true);
});

test('legacy transfer settings are retired without changing stored values', () => {
    const definitions = [{ name: 'HP', persistence: 'variable' },
        { name: 'Wisdom', persistence: 'innate', persistenceReview: true }];
    const values = { HP: '2/10', Wisdom: '8' };
    normaliseStatUpdatePolicies({ npcStats: definitions });
    normaliseNpcPersistence(definitions);
    assert.equal(definitions[0].updatePolicy, 'turn');
    assert.equal(definitions[1].updatePolicy, 'advancement');
    assert.equal(definitions[0].persistence, undefined);
    assert.equal(definitions[1].persistenceReview, undefined);
    assert.deepEqual(values, { HP: '2/10', Wisdom: '8' });
});

test('transfer carries advancement and locked fields and resets turn fields', () => {
    const destination = [
        { name: 'HP', updatePolicy: 'turn', defaultValue: '12/12' },
        { name: 'Wisdom', updatePolicy: 'advancement', defaultValue: '3' },
        { name: 'Level', updatePolicy: 'turn', locked: true, defaultValue: '1' },
    ];
    const mixedLegacyValues = { hp: '2/10', WISDOM: '8', Level: '7', Unknown: 'secret' };
    assert.deepEqual(splitNpcStats(mixedLegacyValues, destination), {
        innate: { Wisdom: '8', Level: '7' }, variable: { HP: '2/10' },
    });
    assert.deepEqual(initialiseNpcStats(mixedLegacyValues, destination), {
        HP: '12/12', Wisdom: '8', Level: '7',
    });
});

test('legacy NPC policy remains editable after migration', () => {
    const innate = { name: 'Wisdom', persistence: 'innate' };
    const variable = { name: 'HP', persistence: 'variable' };
    normaliseStatUpdatePolicies({ npcStats: [innate, variable], playerStats: [] });
    normaliseNpcPersistence([innate, variable]);
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
