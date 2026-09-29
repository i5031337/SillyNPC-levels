import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

function bindFrom(file, names, values) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replace('export function bind', 'function bind');
    return new Function(...names, `${source}\nreturn bind;`)(...values);
}

const settings = {
    statusTracker: {
        playerStats: [{ name: 'HP', defaultValue: '10' }],
        collections: [{ id: 'inventory', target: 'player', fields: [{ name: 'name', isPrimary: true }] }],
    },
    personaData: {
        'Rhea.png': {
            name: 'Rhea', imageUrl: 'portrait.png', profile: { appearance: 'Tall' },
            lorebook: { uid: 7 }, stats: { HP: '3' },
            collections: { inventory: [{ name: 'old sword' }] },
        },
    },
};
let saves = 0;
const deps = { getInitialStatValue: value => value };
bindFrom('../src/tracker/status-persona-state.js',
    ['getContext', 'power_user', 'user_avatar', 'getSettings', 'saveSettings', 'debugLog', 'PROFILE_FIELDS'],
    [() => ({}), { personas: { 'Rhea.png': 'Rhea' } }, 'Rhea.png',
        () => settings, () => { saves++; }, () => {}, []])(deps);

test('fresh chat and persona values start at System defaults, without old global inventory', () => {
    const chatA = { player: { name: 'Rhea', personaKey: 'Rhea.png', ...deps.createChatPlayerSeed() } };
    assert.deepEqual(chatA.player.stats, { HP: '10' });
    assert.deepEqual(chatA.player.collections, { inventory: [] });
    chatA.player.stats.HP = '2';
    chatA.player.collections.inventory.push({ name: 'chat A ring' });
    chatA.player.goals = { short: 'Leave' };
    chatA.player.memories = [{ text: 'A secret' }];
    const chatB = { player: { name: 'Rhea', personaKey: 'Rhea.png', ...deps.createChatPlayerSeed() } };
    assert.equal(chatB.player.stats.HP, '10');
    assert.deepEqual(chatB.player.collections.inventory, []);
    assert.equal(settings.personaData['Rhea.png'].stats.HP, '3');
    assert.equal(settings.personaData['Rhea.png'].imageUrl, 'portrait.png');
    assert.equal(deps.getPlayerCard().imageUrl, 'portrait.png');
    assert.deepEqual(deps.getPlayerCard().lorebook, { uid: 7 });
    assert.equal(saves, 0);

    deps.activatePersona(chatA, 'Other.png', 'Other');
    deps.activatePersona(chatA, 'Rhea.png', 'Rhea');
    assert.equal(chatA.player.stats.HP, '2');
    assert.deepEqual(chatA.player.collections.inventory, [{ name: 'chat A ring' }]);
    assert.deepEqual(chatA.player.goals, { short: 'Leave' });
    assert.deepEqual(chatA.player.memories, [{ text: 'A secret' }]);
});

test('only a legacy tracker chat missing its player migrates old global values', () => {
    const migrated = deps.migrateLegacyPlayer('Rhea.png', 'Rhea');
    assert.equal(migrated.stats.HP, '3');
    assert.deepEqual(migrated.collections.inventory, [{ name: 'old sword' }]);
    assert.equal(deps.createChatPlayerSeed().stats.HP, '10');
});

test('storage loads legacy tracker player from master, but fresh chats use defaults', () => {
    const metadata = { sillynpc_status_state: { global: {}, characters: [] } };
    const storage = {
        STATE_KEY: 'sillynpc_status_state', HISTORY_KEY: 'sillynpc_status_history',
        committedState: null, committedChatId: null, currentChatId: () => 'chat A',
        stateOrigin: new WeakMap(), getMetadata: () => metadata, hasOpenChat: () => true,
        getCurrentPersonaKey: () => 'Rhea.png', getCurrentPersonaName: () => 'Rhea',
        activatePersona: deps.activatePersona, createChatPlayerSeed: deps.createChatPlayerSeed,
        migrateLegacyPlayer: deps.migrateLegacyPlayer,
        createInitialState: () => ({ global: {}, characters: [], player: {} }),
        getInitialStatValue: value => value, clampToCeiling: value => value,
    };
    bindFrom('../src/tracker/status-state-storage.js',
        ['getSettings', 'getContext', 'eventSource', 'debugLog', 'LOG_PREFIX'],
        [() => settings, () => ({ saveMetadataDebounced() {} }), { emit() {} }, () => {}, '[test]'])(storage);
    assert.equal(storage.loadStateFromMetadata().player.stats.HP, '3');

    delete metadata.sillynpc_status_state;
    storage.committedState = null;
    storage.committedChatId = null;
    assert.equal(storage.loadStateFromMetadata().player.stats.HP, '10');
});
