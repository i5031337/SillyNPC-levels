import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { diffTurnValues, applyTurnValues, turnEffectStatus } from '../src/tracker/snapshots/status-turn-delta.js';

function loadModule(path, deps, exports) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replaceAll('export ', '');
    return new Function(...Object.keys(deps), `${source}\nreturn { ${exports} };`)(...Object.values(deps));
}

function harness() {
    const initial = { player: { stats: { HP: '100', XP: '10' } } };
    const outgoing = { player: { stats: { HP: '80', XP: '30' } } };
    let live = structuredClone(outgoing);
    let profiles = { ada: { profile: { mood: 'angry' } } };
    const initialProfiles = { ada: { profile: { mood: 'calm' } } };
    const text = 'Ada strikes you.';
    const effects = { swipe: 0, text, state: diffTurnValues(initial, outgoing),
        profiles: diffTurnValues(initialProfiles, profiles) };
    const message = { mes: text, swipe_id: 0, swipes: [text],
        extra: { sillynpc_turn_effects: effects, sillynpc_applied: [], sillynpc_applied_swipe: 0 },
    };
    message.swipe_info = [{ extra: structuredClone(message.extra) }];
    const base = { messageId: '0', state: initial, profiles: initialProfiles,
        applied: { state: outgoing, profiles: structuredClone(profiles) } };
    const warnings = [];
    const deps = {
        getContext: () => ({ chat: [message] }), swipeBaseRecord: () => base,
        loadStateFromMetadata: () => live, snapshotProfiles: () => structuredClone(profiles),
        restoreProfiles: value => { profiles = structuredClone(value); return []; },
        saveStateToMetadata: value => { live = structuredClone(value); },
        diffTurnValues, applyTurnValues, turnEffectStatus,
        appliedChangesForCurrentSwipe: () => [], applyRows: () => {},
        syncRebasedLore: () => {}, debugLog: () => {},
    };
    const snapshots = loadModule('../src/tracker/snapshots/status-snapshot-swipe.js', deps, 'rebaseToSwipe');
    const events = loadModule('../src/entry/entry-message-events.js', {
        ...deps, ...snapshots,
        clearTurnRecord: id => {
            assert.equal(id, 0);
            for (const key of ['sillynpc_turn_effects', 'sillynpc_applied', 'sillynpc_applied_swipe']) {
                delete message.extra[key];
            }
        },
        toastr: { warning: text => warnings.push(text) }, LOG_PREFIX: 'test',
        getSettings: () => ({ enabled: true }),
        document: { querySelector: () => null }, reprocessMessage: () => {},
        isImageOnlyMessage: () => false, trackerMessageIndex: chat => chat.length - 1,
    }, 'onSwipe');
    return { message, warnings, swipe: () => events.onSwipe(0),
        live: () => live, profiles: () => profiles, initial, initialProfiles };
}

test('a new swipe retaining outgoing prose restores the narrator base before generation', () => {
    const h = harness();
    const savedReply = structuredClone(h.message.swipe_info[0]);
    h.message.swipe_id = 1; // Host creates a slot without clearing mes or custom extra.
    h.live().player.stats.HP = '75'; // A correction after the outgoing reader finished.
    h.swipe();
    assert.deepEqual(h.warnings, []);
    assert.deepEqual(h.live().player.stats, { HP: '75', XP: '10' });
    assert.deepEqual(h.profiles(), h.initialProfiles);
    assert.equal(h.message.extra.sillynpc_turn_effects, undefined);
    assert.deepEqual(h.message.swipe_info[0], savedReply);

    // Returning to the saved reply must still restore its own effects.
    h.message.swipe_id = 0;
    h.message.extra = structuredClone(savedReply.extra);
    h.swipe();
    assert.deepEqual(h.live().player.stats, { HP: '75', XP: '30' });
    assert.equal(h.profiles().ada.profile.mood, 'angry');
    assert.deepEqual(h.warnings, []);
});

test('an existing swipe restores its saved effects', () => {
    const h = harness();
    const text = 'Ada leaves peacefully.';
    h.message.swipes.push(text);
    h.message.swipe_id = 1;
    h.message.mes = text;
    h.message.extra = { sillynpc_turn_effects: { swipe: 1, text,
        state: diffTurnValues(h.initial, { player: { stats: { HP: '100', XP: '15' } } }),
        profiles: [],
    } };
    h.swipe();
    assert.deepEqual(h.live().player.stats, { HP: '100', XP: '15' });
    assert.deepEqual(h.warnings, []);
});

test('changed text in a saved swipe still warns instead of replaying stale effects', () => {
    const h = harness();
    h.message.mes = 'An edited reply.';
    h.swipe();
    assert.equal(h.warnings.length, 1);
    assert.equal(h.live().player.stats.XP, '30');
    assert.ok(h.message.extra.sillynpc_turn_effects);
});

test('an empty incoming slot also restores the pre-reply state', () => {
    const h = harness();
    h.message.mes = '';
    h.swipe();
    assert.deepEqual(h.live(), h.initial);
    assert.deepEqual(h.warnings, []);
});
