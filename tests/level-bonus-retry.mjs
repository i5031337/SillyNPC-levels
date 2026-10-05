import assert from 'node:assert/strict';
import test from 'node:test';
import { selectLevelGrants } from '../src/tracker/extractor/status-level-grants.js';

test('retry preserves validated choices and requests only missing grants without altering XP', async () => {
    const tracker = { playerStats: [
        { id: 'xp', name: 'XP', type: 'bar' }, { id: 'level', name: 'Level', type: 'number' },
        { id: 'aim', name: 'Aim', type: 'number' }],
        progression: { player: { enabled: true, xpFieldId: 'xp', levelFieldId: 'level',
            statGrowth: 'one', statIds: ['aim'] } } };
    const state = { player: { stats: { XP: '9/10', Level: '1', Aim: '2' } } };
    const parsed = { player: { stats: { XP: '20/10' } } };
    const first = await selectLevelGrants(parsed, state, tracker, 'Victory', [], {
        requestExtraction: async prompt => {
            const tasks = JSON.parse(prompt).tasks;
            return { choices: [{ id: tasks[0].id, statId: 'aim', amount: 1 }] };
        } });
    assert.equal(first.rows.length, 1);
    assert.equal(first.failures.length, 1);
    const retry = await selectLevelGrants(parsed, state, tracker, 'Victory', [], {
        cache: first.cache,
        requestExtraction: async prompt => {
            const tasks = JSON.parse(prompt).tasks;
            assert.equal(tasks.length, 1);
            return { choices: [{ id: tasks[0].id, statId: 'aim', amount: 2 }] };
        } });
    assert.equal(retry.rows.length, 2);
    assert.equal(retry.failures.length, 0);
    assert.deepEqual(parsed, { player: { stats: { XP: '20/10' } } });
    assert.equal(state.player.stats.XP, '9/10');
});
