import assert from 'node:assert/strict';
import test from 'node:test';
import { replaceableProfileValue, sourcedMemory } from '../src/core/profile-update-policy.js';
import { appendMemory } from '../src/core/profile-memories.js';

test('old unlocked anchored fields stay unchanged even with a quoted proposal', () => {
    const oldCard = { aiProfileFields: ['appearance'] };
    assert.ok(oldCard.aiProfileFields.includes('appearance'));
    assert.equal(replaceableProfileValue({ id: 'appearance', policy: 'anchored' },
        'A new look', 'cuts her hair', 'She cuts her hair short.'), null);
});

test('replaceable fields require evidence from the latest message', () => {
    const field = { id: 'role', policy: 'replaceable' };
    assert.equal(replaceableProfileValue(field, 'Captain', 'promoted to captain',
        'She is promoted to captain.'), 'Captain');
    assert.equal(replaceableProfileValue(field, 'Captain', 'promoted to captain',
        'She asks about the ship.'), null);
});

test('memory fields append a sourced event only once for repeated extraction', () => {
    const field = { id: 'memories', policy: 'memory' };
    const proposed = { text: 'Met Arin at the harbor.', quote: 'met Arin at the harbor' };
    const candidate = sourcedMemory(field, proposed, 12, 'She met Arin at the harbor.');
    assert.deepEqual(candidate, { fieldId: 'memories', text: proposed.text, sourceMessageId: 12 });
    const first = appendMemory(null, candidate);
    const repeated = appendMemory(first.store, candidate);
    assert.equal(first.added, true);
    assert.equal(repeated.added, false);
    assert.equal(repeated.store.entries.length, 1);
    assert.equal(sourcedMemory({ id: 'memories', policy: 'anchored' }, proposed, 12,
        'She met Arin at the harbor.'), null);
});
