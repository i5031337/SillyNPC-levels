import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/rewrite-baseline/${name}.json`, import.meta.url), 'utf8'));

test('legacy chat fixture keeps its player XP, persona, and swipe base', () => {
    const chat = fixture('old-chat');
    assert.equal(chat.sillynpc_persona, chat.sillynpc_status_state.player.personaKey);
    assert.equal(chat.sillynpc_status_state.player.stats.XP, '3/10');
    assert.equal(chat.sillynpc_status_state.player.stats.Level, '2');
    assert.equal(chat.sillynpc_swipe_base.messageId, '12');
});

test('chat card, portable character, and System fixture retain lore and world data', () => {
    const card = fixture('chat-owned-npc').sillynpc_npcs[0];
    const lorebook = fixture('lorebook-entry');
    const transfer = fixture('character-export-v2');
    const system = fixture('system-export-v2.1');
    assert.deepEqual(card.lorebook, { world: 'Harbor Lore', uid: 42 });
    assert.equal(lorebook.entries[card.lorebook.uid].content, 'Mira is the harbor captain.');
    assert.equal(transfer.format, 'sillynpc-characters');
    assert.equal(transfer.version, 2);
    assert.equal(transfer.characters[0].lore.content, 'Mira is the harbor captain.');
    assert.equal(system.metadata.name, 'Harbor RPG');
    assert.equal(system.world.personaData['Rhea.png'].stats.XP, '3/10');
    assert.equal(system.world.characters[0].name, 'Mira');
});
