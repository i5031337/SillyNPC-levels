import assert from 'node:assert/strict';
import test from 'node:test';
import { describeStatDefinitions } from '../src/tracker/stat-prompt-definitions.js';

test('stat prompt names purpose, numeric bounds, text choices and immutable NPC fields', () => {
    const prompt = describeStatDefinitions({
        globalStats: [{ name: 'Weather', type: 'text', options: ['Sunny', 'Rainy'] }],
        playerStats: [{ name: 'Energy', type: 'number', purpose: 'Spent on spells',
            min: '0', defaultValue: '8/10', options: ['1', '2'] },
        { name: 'Swordplay', type: 'number', updatePolicy: 'advancement', min: '1',
            maxStatValue: '5', purpose: 'Trained skill rating' }],
        npcStats: [{ name: 'Species', type: 'text', purpose: 'Biological kind', locked: true }],
    });
    assert.match(prompt, /World\.Weather: text; Turn; allowed values: Sunny, Rainy/);
    assert.match(prompt, /Player\.Energy: number; Turn; purpose: Spent on spells; minimum current value 0; initialization maximum 10 \(blank stats only\)/);
    assert.doesNotMatch(prompt, /Energy:.*allowed values/);
    assert.match(prompt, /Player\.Swordplay: number; Advancement; purpose: Trained skill rating; minimum current value 1; fixed maximum 5; maximum never increases/);
    assert.match(prompt, /NPC\.Species: text; Turn; purpose: Biological kind; immutable after initialization/);
});
