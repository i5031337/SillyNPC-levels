import assert from 'node:assert/strict';
import test from 'node:test';
import { automaticFillStages } from '../src/fill-preset.js';

test('automatic retry keeps completed stages and leaves portrait opt-in', () => {
    const audit = {
        lore: { done: true }, profile: { done: false }, data: { done: false },
        belongings: { done: false, checked: false }, image: { done: false },
    };
    assert.deepEqual(automaticFillStages(audit), {
        lore: false, profile: true, data: true, belongings: false, image: false,
    });
    assert.equal(automaticFillStages(audit, true).image, true);
});
