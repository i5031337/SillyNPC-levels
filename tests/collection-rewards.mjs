import test from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeCollectionRewards, validateRewardEntry, rewardIdentifier, hasRewardDuplicate,
    collectionRewardAppliesTo, scheduledCollectionRewards, guidedRewardLevels,
} from '../src/core/collection-rewards.js';

const collection = {
    id: 'skills', targets: ['player', 'npc', 'template:monster'], fields: [
        { id: 'skill-key', name: 'title', label: 'Title', type: 'text', isPrimary: true, isStatic: true },
        { id: 'rank', name: 'rank', type: 'number', min: '1', maxStatValue: '5', defaultValue: '1' },
        { id: 'equipped', name: 'equipped', type: 'boolean', defaultValue: 'false', isStatic: false },
        { id: 'school', name: 'school', type: 'text', options: ['fire', 'water'] },
        { id: 'retired', name: 'retired', type: 'text', retired: true },
        { id: 'locked', name: 'locked', type: 'text', locked: true },
    ],
};

test('reward config preserves stable entry IDs through field renames and duplicate row IDs', () => {
    const config = normalizeCollectionRewards({ enabled: true, schedule: [
        { id: 'r', level: '2', entry: { title: 'Flame', rank: 2 } },
        { id: 'r', level: -1, entry: { title: 'Invalid' } },
    ] }, collection);
    assert.deepEqual(config.schedule[0], { id: 'r', level: 2, entry: { 'skill-key': 'Flame', rank: 2 } });
    assert.equal(config.schedule[1].id, 'r-2');
    assert.equal(config.schedule[1].level, 0);
    const renamed = structuredClone(collection);
    renamed.fields[0].name = 'technique';
    assert.equal(validateRewardEntry(renamed, config.schedule[0].entry).entry.technique, 'Flame');
});

test('entry validation respects actual primary, defaults, types, options and ranges', () => {
    const input = { 'skill-key': 'Flame', rank: 3, school: 'fire', locked: 'overwrite', retired: 'old' };
    const before = structuredClone(input);
    assert.deepEqual(validateRewardEntry(collection, input), {
        entry: { title: 'Flame', rank: 3, equipped: false, school: 'fire' }, errors: [],
    });
    assert.deepEqual(input, before);
    for (const entry of [
        { title: '' }, { title: 'Flame', rank: '3' }, { title: 'Flame', rank: 6 },
        { title: 'Flame', rank: 0 }, { title: 'Flame', rank: NaN },
        { title: 'Flame', equipped: 'false' }, { title: 'Flame', school: 'earth' },
    ]) assert.equal(validateRewardEntry(collection, entry).entry, null);
});

test('scheduled rewards include every crossed threshold and avoid holdings and reading duplicates', () => {
    const configured = { ...collection, levelUpRewards: { enabled: true, mode: 'scheduled', schedule: [
        { id: 'two', level: 2, entry: { title: 'Flame' } },
        { id: 'three', level: 3, entry: { title: 'Wave' } },
        { id: 'again', level: 4, entry: { title: 'FLAME' } },
        { id: 'bad', level: 4, entry: { title: 'Invalid', rank: 8 } },
        { id: 'future', level: 5, entry: { title: 'Future' } },
    ] } };
    const before = structuredClone(configured);
    assert.deepEqual(scheduledCollectionRewards(configured, [2, 3, 4]).map(row => row.id), ['two', 'three']);
    assert.deepEqual(scheduledCollectionRewards(configured, [2, 3, 4], { holdings: [{ title: 'flame' }], proposals: [{ entry: { title: 'WAVE' } }] }), []);
    assert.deepEqual(configured, before);
    assert.equal(rewardIdentifier(collection, { 'skill-key': 'FLAME' }), 'flame');
    assert.equal(hasRewardDuplicate(collection, { title: 'Flame' }, [{ title: 'flame' }]), true);
});

test('guided intervals, disabled rewards and empty schedules grant only configured levels', () => {
    const configured = { ...collection, levelUpRewards: { enabled: true, mode: 'guided', interval: 2 } };
    assert.deepEqual(guidedRewardLevels(configured, [2, 3, 4, 5, 6, 6]), [2, 4, 6]);
    assert.deepEqual(guidedRewardLevels({ ...configured, levelUpRewards: { enabled: true, mode: 'guided' } }, [2, 3]), [2, 3]);
    assert.deepEqual(scheduledCollectionRewards(configured, [2, 3]), []);
    assert.deepEqual(guidedRewardLevels(collection, [2, 3]), []);
    assert.deepEqual(scheduledCollectionRewards({ ...collection, levelUpRewards: { enabled: true } }, [2, 3]), []);
});

test('targets overlap without multiplying grants and empty/retired collections do not apply', () => {
    assert.equal(collectionRewardAppliesTo(collection, 'npc', 'monster'), true);
    assert.equal(collectionRewardAppliesTo({ ...collection, targets: ['template:monster'] }, 'npc', 'other'), false);
    assert.equal(collectionRewardAppliesTo({ ...collection, targets: [] }, 'player'), false);
    assert.equal(collectionRewardAppliesTo({ ...collection, retired: true }, 'npc', 'monster'), false);
    assert.equal(collectionRewardAppliesTo({ target: 'npc', npcTemplateId: 'monster' }, 'npc', 'monster'), true);
});
