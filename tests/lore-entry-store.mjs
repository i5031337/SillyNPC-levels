import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoreEntryStore } from '../src/lore/lore-entry-store.js';

test('a cancelled chat request cannot allocate or link a lore entry after loading', async () => {
    let current = true;
    const writes = [];
    const create = createLoreEntryStore({
        load: async () => { current = false; return { entries: {} }; },
        save: async () => writes.push('save'), allocate: () => writes.push('allocate'),
        identify: () => writes.push('identify'), persist: () => writes.push('persist'),
    });
    const card = { name: 'Mira', lorebook: null };
    assert.equal(await create(card, 'Chat', 'Mira', 'owner', { isCurrent: () => current }), null);
    assert.equal(card.lorebook, null);
    assert.deepEqual(writes, []);
});

function fixture() {
    const books = { Chat: { entries: {} } };
    let saves = 0;
    const create = createLoreEntryStore({
        load: async world => structuredClone(books[world]),
        save: async (world, data) => { books[world] = structuredClone(data); saves++; },
        allocate: (world, data) => {
            const uid = Object.keys(data.entries).length;
            return data.entries[uid] = { uid, position: 4, depth: 2 };
        },
        identify: (card, entry) => { entry.comment = card.name; entry.key = [card.name]; },
        persist: () => {},
    });
    return { create, books, saves: () => saves };
}

test('concurrent creation for one NPC allocates one entry, including UID zero', async () => {
    const { create, books, saves } = fixture();
    const npc = { name: 'Mira' };
    const results = await Promise.all(Array.from({ length: 6 }, () => create(npc, 'Chat', npc.name, 'chat1/mira')));
    assert.equal(Object.keys(books.Chat.entries).length, 1);
    assert.ok(results.every(result => result.uid === 0));
    assert.equal(saves(), 1);
});

test('unlinking, renaming, or reloading a card reuses its owned entry and keeps placement', async () => {
    const { create, books } = fixture();
    await create({ name: 'Mira' }, 'Chat', 'Mira', 'chat1/mira');
    const entry = books.Chat.entries[0];
    entry.content = 'Curated lore';
    entry.key.push('Clockmaker');
    const card = { name: 'Mira Renamed', lorebook: null };
    assert.equal((await create(card, 'Chat', card.name, 'chat1/mira')).uid, 0);
    assert.deepEqual(books.Chat.entries[0], entry);
    assert.equal(Object.keys(books.Chat.entries).length, 1);
});

test('same names in different chats remain separate; existing unmarked links are adopted', async () => {
    const { create, books } = fixture();
    const first = await create({ name: 'Mira' }, 'Chat', 'Mira', 'chat1/mira');
    const second = await create({ name: 'Mira' }, 'Chat', 'Mira', 'chat2/mira');
    assert.notEqual(first.uid, second.uid);
    delete books.Chat.entries[first.uid].sillynpcOwner;
    const card = { name: 'Mira', lorebook: first };
    assert.deepEqual(await create(card, 'Chat', card.name, 'chat1/mira'), first);
    assert.equal(Object.keys(books.Chat.entries).length, 2);
    assert.equal(books.Chat.entries[first.uid].sillynpcOwner, 'chat1/mira');
});

test('different NPCs created concurrently retain both entries', async () => {
    const { create, books } = fixture();
    await Promise.all(['Mira', 'Elza'].map(name => create({ name }, 'Chat', name, name)));
    assert.equal(Object.keys(books.Chat.entries).length, 2);
    assert.deepEqual(Object.values(books.Chat.entries).map(entry => entry.comment), ['Mira', 'Elza']);
});
