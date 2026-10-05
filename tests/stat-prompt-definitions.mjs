import assert from 'node:assert/strict';
import test from 'node:test';
import { describeStatDefinitions, describeReaderStats } from '../src/tracker/stat-prompt-definitions.js';

test('stat prompt names purpose, numeric bounds, text choices and immutable NPC fields', () => {
    const prompt = describeStatDefinitions({
        globalStats: [{ name: 'Weather', type: 'text', options: ['Sunny', 'Rainy'] }],
        playerStats: [{ name: 'Energy', type: 'number', purpose: 'Spent on spells',
            min: '0', defaultValue: '8/10', options: ['1', '2'] },
        { name: 'Swordplay', type: 'number', locked: true, min: '1',
            maxStatValue: '5', purpose: 'Trained skill rating' }],
        npcStats: [{ name: 'Species', type: 'text', purpose: 'Biological kind', locked: true }],
    });
    assert.match(prompt, /World\.Weather: text; allowed values: Sunny, Rainy/);
    assert.match(prompt, /Player\.Energy: numeric pool; purpose: Spent on spells; minimum current value 0; starting maximum 10 \(also bounds plain numeric readings\)/);
    assert.doesNotMatch(prompt, /Energy:.*allowed values/);
    assert.match(prompt, /Player\.Swordplay: numeric rating; purpose: Trained skill rating; minimum current value 1; fixed maximum 5; fixed bound/);
    assert.match(prompt, /NPC\.Species: text; purpose: Biological kind; reader cannot change after initialization/);
});

test('reader lists only editable stats without numeric enforcement rules', () => {
    const settings = {
        playerStats: [
            { name: 'Energy', type: 'number', purpose: 'Spent on spells', min: '0', maxStatValue: '5' },
            { name: 'Level', type: 'number' },
            { name: 'Level Bonus', type: 'text' },
            { name: 'Swordplay', type: 'number', locked: true },
            { name: 'Origin', type: 'text', locked: true },
        ],
        npcStats: [
            { name: 'Health', type: 'number', defaultValue: '5/5', min: '0' },
            { name: 'Species', type: 'text', locked: true, options: ['Human', 'Elf'] },
            { name: 'Rank', type: 'number', locked: true },
        ],
    };
    assert.equal(describeReaderStats(settings),
        '- Player.Energy: number; Spent on spells\n- NPC.Health: number');
    assert.equal(describeReaderStats(settings, { initializeNpc: true }),
        '- NPC.Health: number; default: 5/5; min: 0\n- NPC.Species: text; choose: Human, Elf\n- NPC.Rank: number');
});
