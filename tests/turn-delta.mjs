import test from 'node:test';
import assert from 'node:assert/strict';
import { diffTurnValues, applyTurnValues, turnEffectStatus } from '../src/tracker/snapshots/status-turn-delta.js';

test('switching replies carries only the chosen reply plus later manual corrections', () => {
    const base = {
        global: { Time: 'noon' },
        player: { stats: { HP: '100/100' }, goals: {}, memories: [] },
        characters: [{ name: 'Ada', stats: { HP: '20/20' }, goals: {} }],
        npcMemories: {},
    };
    const first = structuredClone(base);
    first.player.stats.HP = '90/100';
    first.player.goals.shortTerm = 'Find the key';
    first.npcMemories.ada = [{ text: 'Lost a key', source: '7' }];
    const firstDelta = diffTurnValues(base, first);
    const manual = structuredClone(first);
    manual.player.stats.HP = '95/100';
    manual.characters[0].stats.HP = '18/20';
    const corrections = diffTurnValues(first, manual);
    const second = structuredClone(base);
    second.global.Time = 'evening';
    second.player.goals.shortTerm = 'Reach camp';
    const switched = applyTurnValues(applyTurnValues(base, diffTurnValues(base, second)), corrections);
    assert.equal(switched.player.stats.HP, '95/100');
    assert.equal(switched.characters[0].stats.HP, '18/20');
    assert.equal(switched.player.goals.shortTerm, 'Reach camp');
    assert.equal(switched.global.Time, 'evening');
    assert.deepEqual(switched.npcMemories, {});
    assert.deepEqual(applyTurnValues(base, firstDelta), first);
    assert.equal(base.player.stats.HP, '100/100');
});

test('a reply can add and remove collections while a manual profile edit survives', () => {
    const base = { ada: { profile: { role: 'Scout', appearance: 'blue coat' }, memories: [] } };
    const reply = structuredClone(base);
    reply.ada.profile.role = 'Leader';
    reply.ada.memories.push({ text: 'Joined the party', source: '12' });
    const edited = structuredClone(reply);
    edited.ada.profile.appearance = 'red coat';
    const correction = diffTurnValues(reply, edited);
    const otherReply = applyTurnValues(base, correction);
    assert.equal(otherReply.ada.profile.role, 'Scout');
    assert.equal(otherReply.ada.profile.appearance, 'red coat');
    assert.deepEqual(otherReply.ada.memories, []);
});

test('actor edits follow names when another reply changes scene order', () => {
    const before = [{ name: 'Ada', stats: { HP: '20' } }, { name: 'Bea', stats: { HP: '30' } }];
    const corrected = structuredClone(before);
    corrected[0].stats.HP = '18';
    const nextReply = [before[1], before[0]];
    const result = applyTurnValues(nextReply, diffTurnValues(before, corrected));
    assert.equal(result[0].stats.HP, '30');
    assert.equal(result[1].stats.HP, '18');
});

test('new scene actor does not fold an earlier manual correction into reply effects', () => {
    const base = { characters: [{ name: 'Ada', stats: { HP: '20' } }] };
    const beforeApply = { characters: [{ name: 'Ada', stats: { HP: '18' } }] };
    const afterApply = { characters: [
        { name: 'Ada', stats: { HP: '18' } },
        { name: 'Bea', stats: { HP: '30' } },
    ] };
    const replyOnly = applyTurnValues(base, diffTurnValues(beforeApply, afterApply));
    assert.equal(replyOnly.characters[0].stats.HP, '20');
    assert.equal(replyOnly.characters[1].name, 'Bea');
    const manual = diffTurnValues(replyOnly, afterApply);
    assert.equal(applyTurnValues(base, manual).characters[0].stats.HP, '18');
});

test('repeated swipe keeps each reply separate', () => {
    const base = { player: { stats: { HP: '100' } } };
    const first = { player: { stats: { HP: '90' } } };
    const second = { player: { stats: { HP: '80' } } };
    const firstEffect = diffTurnValues(base, first);
    const secondEffect = diffTurnValues(base, second);
    let live = applyTurnValues(base, firstEffect);
    live = applyTurnValues(base, secondEffect);
    assert.equal(live.player.stats.HP, '80');
    live = applyTurnValues(base, firstEffect);
    assert.equal(live.player.stats.HP, '90');
    live = applyTurnValues(base, secondEffect);
    assert.equal(live.player.stats.HP, '80');
});

test('a saved effect for another swipe or edited text is rejected', () => {
    const effect = { swipe: 0, text: 'old reply' };
    assert.equal(turnEffectStatus(effect, { swipe_id: 1, mes: 'new reply' }), 'mismatch');
    assert.equal(turnEffectStatus(effect, { swipe_id: 0, mes: 'edited reply' }), 'mismatch');
    assert.equal(turnEffectStatus(effect, { swipe_id: 0, mes: 'old reply' }), 'valid');
    assert.equal(turnEffectStatus(undefined, { swipe_id: 1, mes: 'new reply' }), 'absent');
});
