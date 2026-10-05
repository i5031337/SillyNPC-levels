import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseNpcPersistence, splitNpcStats, initialiseNpcStats } from '../src/tracker/stat-persistence.js';
import { normaliseStatUpdatePolicies, isReaderStat } from '../src/tracker/stat-update-policy.js';
import { progressionStatEligible } from '../src/core/progression-config.js';
import { prepareGrantReview } from '../src/tracker/level-grant-review.js';

test('canonical growth eligibility allows locked and excludes retired and progression fields', () => {
    const rating = { id: 'power', name: 'Power', type: 'number', updatePolicy: 'advancement' };
    const config = { xpFieldId: 'earned', levelFieldId: 'rank' };
    assert.equal(progressionStatEligible(rating, config), true);
    assert.equal(progressionStatEligible({ ...rating, locked: true }, config), true);
    assert.equal(progressionStatEligible({ ...rating, retired: true }, config), false);
    assert.equal(progressionStatEligible({ ...rating, id: 'rank' }, config), false);
});

test('legacy transfer settings are retired without changing stored values', () => {
    const definitions = [{ name: 'HP', persistence: 'variable' },
        { name: 'Wisdom', persistence: 'innate', persistenceReview: true }];
    const values = { HP: '2/10', Wisdom: '8' };
    normaliseStatUpdatePolicies({ npcStats: definitions });
    normaliseNpcPersistence(definitions);
    assert.equal(definitions[0].carryOver, false);
    assert.equal(definitions[1].carryOver, true);
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
    normaliseStatUpdatePolicies({ npcStats: destination });
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
    assert.equal(innate.locked, true);
    assert.equal(isReaderStat(innate), false);
    assert.equal(isReaderStat(variable), true);
    innate.locked = false;
    assert.equal(isReaderStat(innate), true);
});

test('existing numeric player fields keep level-up eligibility separately from turn policy', () => {
    const tracker = { playerStats: [
        { id: 'strength', name: 'Strength', defaultValue: '5' },
        { id: 'xp', name: 'XP', defaultValue: '0/100' },
        { name: 'Level', defaultValue: '1' },
        { name: 'Level Bonus', defaultValue: '' },
    ], npcStats: [] };
    normaliseStatUpdatePolicies(tracker);
    assert.equal(tracker.playerStats[0].locked, false);
    assert.equal(progressionStatEligible(tracker.playerStats[0]), true);
    assert.equal(progressionStatEligible(tracker.playerStats[1]), false);
    assert.equal(tracker.playerStats[2].updatePolicy, undefined);
    assert.equal(tracker.playerStats[3].updatePolicy, undefined);
});

test('structured growth grants wait for review while earned XP and Level apply', () => {
    const auto = [
        { scope: 'player', actor: null, kind: 'stat', label: 'Experience' },
        { scope: 'player', actor: null, kind: 'stat', label: 'Rank' },
        { scope: 'player', actor: null, kind: 'stat', label: 'Strength', grant: { id: 'growth', gain: 1 } },
    ];
    const pending = [];
    prepareGrantReview(auto, pending, [{ transitionId: 'turn:2', scope: 'player', actor: null,
        xpName: 'Experience', levelName: 'Rank', oldLevel: 1, newLevel: 2 }]);
    assert.deepEqual(auto.map(change => change.label), ['Experience', 'Rank']);
    assert.equal(pending[0].grant.id, 'growth');
    assert.equal(auto[0].transition.transitionId, 'turn:2');
});

test('NPC Advancement experience, level, and earned ratings survive a new adventure without backfill', () => {
    const definitions = [
        { id: 'earned', name: 'Experience', updatePolicy: 'advancement', defaultValue: '0/100' },
        { id: 'rank', name: 'Rank', updatePolicy: 'advancement', defaultValue: '1' },
        { id: 'power', name: 'Power', updatePolicy: 'advancement', defaultValue: '3' },
        { id: 'health', name: 'Health', updatePolicy: 'turn', defaultValue: '10/10' },
    ];
    normaliseStatUpdatePolicies({ npcStats: definitions, npcTemplates: [{ progression: { xpFieldId: 'earned' } }] });
    assert.equal(definitions[0].locked, false);
    const earned = { Experience: '17/100', Rank: '4', Power: '6', Health: '2/12' };
    const transferred = initialiseNpcStats(earned, definitions);
    assert.deepEqual(transferred, { Experience: '17/100', Rank: '4', Power: '6', Health: '10/10' });
    assert.deepEqual(earned, { Experience: '17/100', Rank: '4', Power: '6', Health: '2/12' });
    // A different destination template only carries fields it actually selects.
    assert.deepEqual(initialiseNpcStats(earned, [definitions[3]]), { Health: '10/10' });
    assert.deepEqual(initialiseNpcStats({}, definitions), {
        Experience: '0/100', Rank: '1', Power: '3', Health: '10/10',
    });
});
