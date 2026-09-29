import assert from 'node:assert/strict';
import test from 'node:test';
import { validGoalProposal } from '../src/tracker/goal-proposals.js';

const field = { id: 'shortTerm', label: 'Short-term goal' };
const message = 'Mira finds the map and decides to reach the northern gate.';

test('goal proposals require configured fields and a quote from this turn', () => {
    const proposal = { action: 'set', text: 'Reach the northern gate', quote: 'decides to reach the northern gate' };
    assert.deepEqual(validGoalProposal(field, '', proposal, message), proposal);
    assert.equal(validGoalProposal(null, '', proposal, message), null);
    assert.equal(validGoalProposal(field, '', { ...proposal, quote: 'a previous conversation' }, message), null);
});

test('goal actions describe actual transitions', () => {
    assert.equal(validGoalProposal(field, 'Find the map', { action: 'set', text: 'Reach the gate', quote: 'finds the map' }, message), null);
    assert.deepEqual(validGoalProposal(field, 'Find the map', {
        action: 'replace', text: 'Reach the northern gate', quote: 'decides to reach the northern gate',
    }, message), { action: 'replace', text: 'Reach the northern gate', quote: 'decides to reach the northern gate' });
    assert.deepEqual(validGoalProposal(field, 'Find the map', {
        action: 'complete', text: 'ignored', quote: 'finds the map',
    }, message), { action: 'complete', text: '', quote: 'finds the map' });
    assert.equal(validGoalProposal(field, '', { action: 'complete', quote: 'finds the map' }, message), null);
});
