import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { progressXp, boostStat } from '../src/tracker/progression.js';

const source = readFileSync(new URL('../src/tracker/extractor/status-extractor-replies.js', import.meta.url), 'utf8');
const bonusFunction = source.slice(source.indexOf('export async function addLevelBonus'),
    source.indexOf('\n/** Apply only configured'))
    .replace('export async function', 'async function');

test('an invalid level bonus can be retried without consuming the XP update', async () => {
    let reply = 'I should think through all the possibilities first.';
    const addLevelBonus = new Function('progressXp', 'boostStat', 'splitValue', 'canAdvanceStat',
        'buildLevelBonusPrompt', 'requestExtraction', 'coerceToUpdate', 'promptText',
        `${bonusFunction}\nreturn addLevelBonus;`)(
        progressXp, boostStat, () => ({}), () => false,
        () => 'prompt', async () => reply, raw => { try { return JSON.parse(raw); } catch { return null; } },
        () => 'system',
    );
    const state = { player: { stats: { XP: '90/100', Level: '1', 'Level Bonus': '' } } };
    const parsed = { player: { stats: { XP: '110/100' } } };
    const settings = { playerStats: [{ name: 'Level Bonus' }] };

    await assert.rejects(addLevelBonus(parsed, state, settings, 'A victory'), error =>
        error.output === reply && /could not be read/.test(error.message));
    assert.deepEqual(parsed.player.stats, { XP: '110/100' });

    reply = '{"description":"A sharper eye for hidden doors"}';
    const result = await addLevelBonus(parsed, state, settings, 'A victory');
    assert.deepEqual(result, { stat: null, bonusName: 'Level Bonus' });
    assert.equal(parsed.player.stats['Level Bonus'], 'Level 2: A sharper eye for hidden doors');
});
