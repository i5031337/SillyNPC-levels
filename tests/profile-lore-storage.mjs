import { collectionQuantityField } from '../src/core/collection-fields.js';
import { profileFieldsForCard } from '../src/core/profile-fields.js';
import { normalizeMemoryStore } from '../src/core/profile-memories.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { formatLoreContent, parseLoreContent, mergeLoreValues } from '../src/lore/lore-format.js';
import { createLoreEntryStore } from '../src/lore/lore-entry-store.js';
import { promptText } from '../src/prompts/prompt-texts.js';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export async function ', 'async function ')
    .replaceAll('export function ', 'function ') + `\n${collectionQuantityField.toString()}\n`;

test('player profile saves create and update one lore entry using player fields', async () => {
    const book = { entries: {} };
    const identify = (card, entry) => {
        entry.comment = card.name;
        entry.key = [card.name];
        if (entry.content) entry.content = `### ${card.name}\n${entry.content.replace(/^###[^\n]*\n/, '')}`;
        return true;
    };
    const create = createLoreEntryStore({
        load: async () => book, save: async () => {}, identify, persist: () => {},
        allocate: (world, data) => {
            const uid = Object.keys(data.entries).length;
            return data.entries[uid] = { uid };
        },
    });
    const dependencies = {
        loadWorldInfo: async () => book, saveWorldInfo: async () => {},
        formatLoreContent, parseLoreContent, mergeLoreValues, profileFieldsForCard, normalizeMemoryStore,
        saveSettings: () => {}, syncEntryIdentity: identify,
        ensureChatLorebookForFill: async () => 'Chat',
        createLoreEntry: (card, world) => create(card, world, card.name, 'player/avatar'),
    };
    const sync = new Function(...Object.keys(dependencies),
        source('../src/lore/lore-sync.js') + '\nreturn syncProfileToLore;')(...Object.values(dependencies));
    const player = { name: 'Hero', isPlayer: true, profile: { appearance: 'Red cloak' } };
    await Promise.all([sync(player), sync(player), sync(player)]);
    assert.equal(Object.keys(book.entries).length, 1);
    assert.equal(player.lorebook.uid, 0);
    assert.equal(parseLoreContent(book.entries[0].content, { scope: 'player' }).appearance, 'Red cloak');
    assert.ok(!book.entries[0].content.includes('Role:'));
    player.profile.appearance = 'Blue cloak';
    await sync(player);
    assert.equal(Object.keys(book.entries).length, 1);
    assert.match(book.entries[0].content, /Appearance: Blue cloak/);
    player.lorebook = null;
    await sync(player);
    assert.equal(Object.keys(book.entries).length, 1);
});

test('scene status contains tracker fields but no player, present NPC, or referenced NPC profiles', () => {
    const settings = { statusTracker: { collections: [], historyNotes: false } };
    const referenced = { name: 'Elza', profile: { appearance: 'OFFSTAGE_PROFILE' },
        statusOverrides: { HP: '7' } };
    const deps = { statsInSystem: stats => stats || {},
        getPlayerCard: () => { throw new Error('Profiles must not be read'); },
        findCardForName: () => { throw new Error('Profiles must not be read'); } };
    const bind = new Function('promptText', 'getSettings', 'charactersFromActivatedLore',
        source('../src/tracker/status-status-summary.js') + '\nreturn bind;')(
        promptText, () => settings, () => [referenced]);
    bind(deps);
    const state = { global: { Time: 'Noon' },
        player: { name: 'Hero', stats: { HP: '10' }, profile: { appearance: 'PLAYER_PROFILE' } },
        characters: [{ name: 'Mira', stats: { HP: '8' }, profile: { appearance: 'NPC_PROFILE' } }] };
    const result = deps.formatCompactStatus(state, true);
    assert.match(result, /\[Current Scene Status\]/);
    for (const line of ['Global: Time=Noon', 'Player (Hero): HP=10', 'Mira: HP=8', 'Elza - HP=7']) {
        assert.ok(result.includes(line), result);
    }
    assert.ok(!result.includes('PROFILE'));
    assert.ok(!result.includes('Who they are'));
});

test('memory-only NPCs create a lore entry and sync active memories, excluding archived ones', async () => {
    const book = { entries: {} };
    let created = 0;
    let saved = 0;
    const dependencies = {
        loadWorldInfo: async () => book, saveWorldInfo: async () => { saved++; },
        formatLoreContent, parseLoreContent, mergeLoreValues, profileFieldsForCard: () => [], normalizeMemoryStore,
        saveSettings: () => {}, syncEntryIdentity: () => false,
        ensureChatLorebookForFill: async () => 'Chat',
        createLoreEntry: async card => {
            created++;
            card.lorebook = { world: 'Chat', uid: 0 };
            book.entries[0] = { uid: 0, content: '', comment: card.name };
        },
    };
    const sync = new Function(...Object.keys(dependencies),
        source('../src/lore/lore-sync.js') + '\nreturn syncProfileToLore;')(...Object.values(dependencies));
    const npc = { name: 'Mira', profile: {} };
    await sync(npc, { entries: [], archive: [{ text: 'Archived promise' }] });
    assert.equal(created, 0, 'archived-only memories do not allocate an entry');
    await sync(npc, { entries: [{ text: 'Promised to meet at the harbor' }],
        archive: [{ text: 'Archived promise' }] });
    assert.equal(created, 1);
    assert.match(book.entries[0].content, /### Memories\n- Promised to meet at the harbor/);
    assert.ok(!book.entries[0].content.includes('Archived promise'));
    await sync(npc, { entries: [{ text: 'Learned the harbor was closed' }], archive: [] });
    assert.equal(created, 1);
    assert.match(book.entries[0].content, /Learned the harbor was closed/);
    assert.ok(!book.entries[0].content.includes('Promised to meet'));
    assert.equal(saved, 2);
});
