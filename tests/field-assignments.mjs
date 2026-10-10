import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldsShareActor, fieldAssignmentConflicts } from '../src/core/system-fields.js';

test('field assignments overlap only for selectable actor combinations', () => {
    const player = {targets: ['player']}, npc = {targets: ['npc']};
    const mage = {targets: ['template:mage']}, warrior = {targets: ['template:warrior']};
    assert.equal(fieldsShareActor(player, npc), false);
    assert.equal(fieldsShareActor(mage, warrior), false);
    assert.equal(fieldsShareActor(npc, mage), true);
    assert.equal(fieldsShareActor(mage, mage), true);
    assert.equal(fieldsShareActor({targets: []}, npc), false);
});

test('assignment and rename checks allow separate namesakes and reject overlapping ones', () => {
    const player = {id: 'player-health', name: 'Health', targets: ['player']};
    const npc = {id: 'npc-health', name: 'Health', targets: ['npc']};
    const retired = {id: 'old', name: 'Health', targets: ['player'], retired: true};
    const fields = [player, npc, retired];
    assert.deepEqual(fieldAssignmentConflicts(fields, player), []);
    assert.deepEqual(fieldAssignmentConflicts(fields, player, {targets: ['player', 'template:mage']}), [npc]);
    assert.deepEqual(fieldAssignmentConflicts(fields, {name: 'health', targets: ['player']}), [player]);
    assert.deepEqual(fieldAssignmentConflicts(fields, player, {name: 'Vitality'}), []);
    const profiles = [{label: 'Biography', targets: ['template:mage']}];
    assert.deepEqual(fieldAssignmentConflicts(profiles, {label: 'Biography', targets: ['player']}), []);
    assert.deepEqual(fieldAssignmentConflicts(profiles, {label: 'Biography', targets: ['npc']}), profiles);
});
