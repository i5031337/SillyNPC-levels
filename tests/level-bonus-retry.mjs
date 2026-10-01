import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { progressXp, boostStat } from '../src/tracker/progression.js';
import { holdLevelBonusChanges } from '../src/tracker/stat-update-policy.js';

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

test('numeric level bonus changes only the current stat and shows its description in review', async () => {
    const addLevelBonus = new Function('progressXp', 'boostStat', 'splitValue', 'canAdvanceStat',
        'buildLevelBonusPrompt', 'requestExtraction', 'coerceToUpdate', 'promptText',
        `${bonusFunction}\nreturn addLevelBonus;`)(
        progressXp, boostStat,
        value => ({ current: String(value).split('/')[0] }),
        def => def.advanceOnLevel === true,
        () => 'prompt', async () => '{"description":"Training sharpened her aim","stat":"Aim","amount":1}',
        JSON.parse, () => 'system',
    );
    const state = { player: { stats: { XP: '90/100', Level: '1', 'Level Bonus': '', Aim: '2/5' } } };
    const parsed = { player: { stats: { XP: '110/100' } } };
    const settings = { playerStats: [{ name: 'Level Bonus' }, { name: 'Aim', advanceOnLevel: true }] };

    const bonus = await addLevelBonus(parsed, state, settings, 'A victory');
    assert.deepEqual(parsed.player.stats, { XP: '110/100', Aim: '3/5' });
    assert.deepEqual(bonus, { stat: 'Aim', description: 'Training sharpened her aim' });

    const auto = [{ scope: 'player', label: 'Aim', kind: 'stat', after: '3' }];
    const pending = [];
    holdLevelBonusChanges(auto, pending, bonus);
    assert.deepEqual(auto, []);
    assert.deepEqual(pending, [{ scope: 'player', label: 'Aim', kind: 'stat', after: '3',
        risk: 'risky', reason: 'Level-up bonus', note: 'Training sharpened her aim' }]);

    const alreadyPending = [{ scope: 'player', label: 'Aim', kind: 'stat', after: '3' }];
    holdLevelBonusChanges([], alreadyPending, bonus);
    assert.equal(alreadyPending[0].note, 'Training sharpened her aim');
});
