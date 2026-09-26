import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { canTrackerSetNpcStat } from '../src/stat-persistence.js';
import { progressXp } from '../src/progression.js';

// This module's SillyTavern imports require a browser. Inject those boundaries
// while exercising its real bind(deps) implementation in Node.
const source = readFileSync(new URL('../src/status-apply-update.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replace('export function bind', 'function bind');
const loadBind = new Function('eventSource', 'getSettings', 'saveSettings',
    'canTrackerSetNpcStat', 'getAllCharacters', 'LOG_PREFIX', 'debugLog', 'progressXp',
    `${source}\nreturn bind;`);

function fixture({ openChat = true, castMode = 'ai' } = {}) {
    const card = { name: 'Mira', aliases: [], statusOverrides: {}, statusCollections: {} };
    const settings = {
        statusTracker: {
            castMode, sceneBindingStat: 'Scene',
            globalStats: [{ name: 'Scene' }],
            playerStats: [{ name: 'HP' }],
            npcStats: [{ name: 'HP', persistence: 'variable' }],
            collections: [{ id: 'items' }],
        },
    };
    const initial = {
        global: { Scene: 'old' },
        player: { stats: { HP: '5' }, collections: { items: ['sword'] } },
        characters: [
            { name: 'Mira', boundTo: 'old', stats: { HP: '4' }, collections: { items: ['ring'] } },
            { name: 'Jon', boundTo: 'old', stats: { HP: '3' }, collections: {} },
        ],
        recently_deleted: { items: { lost: 1, retained: 2 } },
    };
    const calls = { saved: [], synced: [], emitted: [], settings: 0 };
    const bind = loadBind(
        { emit: (...args) => calls.emitted.push(args) },
        () => settings,
        () => { calls.settings++; },
        canTrackerSetNpcStat,
        () => [card],
        '[test]',
        () => {},
        progressXp,
    );
    const deps = {
        committedState: initial,
        hasOpenChat: () => openChat,
        loadStateFromMetadata: () => initial,
        mergeStatValue: (_old, value) => value,
        constrainToDefinition: (_def, value) => value,
        findMatchingStatKey: (stats, name) =>
            Object.keys(stats).find(key => key.toLowerCase() === name.toLowerCase()),
        groupIncomingStats: (stats, resolve, valid, skip) => {
            const groups = new Map();
            for (const [name, value] of Object.entries(stats)) {
                if (skip(name)) continue;
                const key = resolve(name);
                if (key && valid(key)) groups.set(key, { whole: value });
            }
            return groups;
        },
        combineStatValue: (_old, group) => group.whole,
        applyCollectionUpdate: (owner, id, value) => {
            owner.collections[id] = value;
        },
        resolveCanonicalName: name => name,
        mayJoinScene: () => true,
        buildCharacterState: name => ({ name, stats: { HP: '' }, collections: {} }),
        updateCardOffstage: () => null,
        saveStateToMetadata: (...args) => calls.saved.push(args),
        syncPlayerToMaster: (...args) => calls.synced.push(args),
    };
    bind(deps);
    return { deps, card, calls, initial };
}

test('committed update changes state and card, then saves and syncs once', () => {
    const { deps, card, calls, initial } = fixture();
    const state = deps.applyUpdate({
        global: { scene: 'new' },
        player: { stats: { hp: '7' }, items: ['book'] },
        characters: [{ name: 'Mira', stats: { hp: '8' }, items: ['key'] }],
    });
    assert.equal(state.global.Scene, 'new');
    assert.equal(state.player.stats.HP, '7');
    assert.deepEqual(state.player.collections.items, ['book']);
    assert.deepEqual(state.characters.map(char => char.name), ['Mira']);
    assert.equal(state.characters[0].boundTo, 'new');
    assert.equal(state.characters[0].stats.HP, '8');
    assert.deepEqual(state.characters[0].collections.items, ['key']);
    assert.equal(card.statusOverrides.HP, '8');
    assert.deepEqual(card.statusCollections.items, ['key']);
    assert.deepEqual(state.recently_deleted, { items: { retained: 1 } });
    assert.equal(initial.global.Scene, 'old');
    assert.equal(calls.settings, 1);
    assert.equal(calls.saved.length, 1);
    assert.equal(calls.synced.length, 1);
    assert.deepEqual(calls.synced[0][1], { authoritative: true });
    assert.equal(calls.emitted.length, 1);
});

test('dry run previews character changes without mutating card or committing', () => {
    const { deps, card, calls } = fixture({ openChat: false });
    const state = deps.applyUpdate({
        characters: [{ name: 'Mira', stats: { HP: '9' }, collections: { items: ['map'] } }],
    }, { dryRun: true });
    assert.equal(state.characters[0].stats.HP, '9');
    assert.deepEqual(state.characters[0].collections.items, ['map']);
    assert.deepEqual(card.statusOverrides, {});
    assert.deepEqual(card.statusCollections, {});
    assert.equal(calls.settings, 0);
    assert.equal(calls.saved.length, 0);
    assert.equal(calls.synced.length, 0);
    assert.equal(calls.emitted.length, 0);
});

test('missing chat rejects before card writes', () => {
    const { deps, card, calls } = fixture({ openChat: false });
    const priorWarn = console.warn;
    console.warn = () => {};
    try {
        assert.equal(deps.applyUpdate({ characters: [{ name: 'Mira', stats: { HP: '9' } }] }), null);
    } finally {
        console.warn = priorWarn;
    }
    assert.deepEqual(card.statusOverrides, {});
    assert.equal(calls.settings, 0);
    assert.equal(calls.saved.length, 0);
});
