import assert from 'node:assert/strict';
import test from 'node:test';
import { automaticFillStages } from '../src/prompts/fill-preset.js';

test('automatic Fill draws missing portraits by default and keeps completed stages', () => {
    const audit = {
        lore: { done: true }, data: { done: false },
        belongings: { done: false, checked: false }, image: { done: false },
    };
    assert.deepEqual(automaticFillStages(audit), {
        lore: false, data: true, belongings: false, image: true,
    });
    assert.equal(automaticFillStages(audit, false).image, false);
    assert.equal(automaticFillStages({ ...audit, image: { done: true } }).image, false);
});
