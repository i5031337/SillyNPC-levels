import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSystemDefinition } from '../src/core/system-schema.js';
import { archiveNpcGoals, goalActorFor, goalFields, goalLines, setGoal } from '../src/tracker/goals.js';

test('System goal switches select only configured current fields', () => {
    const definition = normalizeSystemDefinition({ schemaVersion: 1,
        goals: { npcShortTerm: false, playerLongTerm: false } });
    const settings = { activeSystem: 'Story', statusTracker: { presets: {
        Story: { definition },
    } } };
    assert.deepEqual(goalFields('player', settings).map(field => field.id), ['shortTerm']);
    assert.deepEqual(goalFields('npc', settings), []);
    assert.deepEqual(goalFields('world', settings), []);
    assert.deepEqual(goalLines({ goals: { shortTerm: 'Find shelter', longTerm: 'Go home' } },
        'player', settings).map(field => field.value), ['Find shelter']);
});

test('set, replace and complete keep source and enforce explicit transitions', () => {
    const actor = { name: 'Mira' };
    assert.equal(setGoal(actor, 'shortTerm', 'Find the key',
        { action: 'set', messageId: 'm1', quote: 'I need that key.' }), true);
    assert.equal(setGoal(actor, 'shortTerm', 'Find the lock', { action: 'set' }), false);
    assert.equal(setGoal(actor, 'shortTerm', 'Open the vault',
        { action: 'replace', messageId: 'm2', quote: 'Now for the vault.' }), true);
    assert.equal(setGoal(actor, 'shortTerm', '',
        { action: 'complete', messageId: 'm3', quote: 'The vault is open.' }), true);
    assert.equal(goalLines(actor, 'npc')[0].value, '');
    assert.deepEqual(actor.goalSources.shortTerm,
        { messageId: 'm3', quote: 'The vault is open.', action: 'complete' });
    assert.equal(setGoal(actor, 'shortTerm', '', { action: 'complete' }), false);
});

test('NPC goals survive scene departure in chat state by stable card ID', () => {
    const state = { characters: [{ id: 'card-1', name: 'Mira', goals: { shortTerm: 'Leave town' },
        goalSources: { shortTerm: { messageId: 'm1', quote: 'I leave tonight.', action: 'set' } } }] };
    assert.equal(archiveNpcGoals(state, state.characters[0]), true);
    state.characters = [];
    assert.equal(goalActorFor(state, 'Renamed Mira', 'card-1').goals.shortTerm, 'Leave town');
    assert.equal(state.npcGoals['card-1'].goalSources.shortTerm.messageId, 'm1');
});
