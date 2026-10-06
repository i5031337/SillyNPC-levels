import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { diffTurnValues, applyTurnValues, turnEffectStatus } from '../src/tracker/snapshots/status-turn-delta.js';

function load(path, deps, exports) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replaceAll('export ', '');
    return new Function(...Object.keys(deps), `${source}\nreturn { ${exports} };`)(...Object.values(deps));
}

function fixture() {
    const context = { chat: [{ mes: 'Ada: Hello.', swipe_id: 0 }], chatMetadata: {} };
    let state = { global: {}, player: { stats: { HP: '100' } }, characters: [],
        presence: { tick: 0, messageId: null, seen: [] } };
    const deps = {
        getContext: () => context, getAllCharacters: () => [],
        getSettings: () => ({ statusTracker: { npcStats: [] } }),
        saveSettings() {}, debugLog() {}, eventSource: { emit() {} },
        diffTurnValues, applyTurnValues, turnEffectStatus,
        loadStateFromMetadata: () => state,
        saveStateToMetadata: value => { state = structuredClone(value); },
        resolveCanonicalName: name => name, mayJoinScene: () => true,
        mergeDuplicateCharacters: () => false,
        npcStatsFor: () => [], npcTemplateFor: () => null,
        appliedChangesForCurrentSwipe: () => [], applyRows() {}, syncRebasedLore() {},
    };
    load('../src/tracker/status-chat-session.js', deps, 'bind').bind(deps);
    load('../src/tracker/status-scene-presence.js', deps, 'bind').bind(deps);
    const snapshots = load('../src/tracker/snapshots/status-snapshot-swipe.js', deps, 'revertToBase, rebaseToSwipe');
    return { deps, context, snapshots, state: () => state };
}

for (const reader of [false, true]) test(`regeneration removes rendered speakers${reader ? ' after reader updates' : ' without a reader'}`, () => {
    const h = fixture();
    h.deps.reconcileScenePresence(['Ada'], 0);
    assert.deepEqual(h.state().characters.map(c => c.name), ['Ada']);
    assert.deepEqual(h.deps.getSwipeBase(0).characters, []);
    if (reader) {
        h.deps.refreshTurnBase(0);
        h.deps.reconcileScenePresence(['Ada', 'Bea'], 0, { authoritative: true });
        h.state().player.stats.HP = '80';
        h.deps.recordTurnEffects(0);
    }
    const saved = structuredClone(h.context.chat[0].extra);
    const replyState = applyTurnValues(h.deps.getSwipeBase(0), saved.sillynpc_turn_effects.state);
    assert.deepEqual(replyState.characters.map(c => c.name), reader ? ['Ada', 'Bea'] : ['Ada']);
    assert.equal(replyState.player.stats.HP, reader ? '80' : '100');
    h.deps.registerActiveCharacter('Manual');
    h.state().player.stats.HP = '95';
    assert.equal(h.snapshots.revertToBase(0).reverted, true);
    assert.deepEqual(h.state().characters.map(c => c.name), ['Manual']);
    assert.equal(h.state().presence.tick, 0);
    assert.equal(h.state().player.stats.HP, '95');
    // Host deletion may ask for the rollback again.
    h.snapshots.revertToBase(0);
    assert.deepEqual(h.state().characters.map(c => c.name), ['Manual']);
    h.context.chat[0].extra = saved;
    assert.equal(h.snapshots.rebaseToSwipe(0).rebased, true);
    assert.deepEqual(h.state().characters.map(c => c.name), reader ? ['Ada', 'Bea', 'Manual'] : ['Ada', 'Manual']);
});

test('later speaker redraws accumulate presence effects and preserve manual additions', () => {
    const h = fixture();
    h.deps.reconcileScenePresence(['Ada'], 0);
    h.deps.registerActiveCharacter('Manual');
    h.deps.reconcileScenePresence(['Ada', 'Bea'], 0);
    h.snapshots.revertToBase(0);
    assert.deepEqual(h.state().characters.map(c => c.name), ['Manual']);
});
