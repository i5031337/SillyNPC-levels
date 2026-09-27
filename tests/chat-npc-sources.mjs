import assert from 'node:assert/strict';
import test from 'node:test';
import { chatNpcSources, chatNpcImagePaths } from '../src/chat/chat-npc-sources.js';

test('world export includes independent NPCs from every assigned chat', () => {
    const headers = [
        { file_id: 'first', avatar: 'a.png', chat_metadata: {
            sillynpc_system: 'A', sillynpc_npcs: [{ id: 'one', name: 'Mira' }],
        } },
        { file_id: 'second', avatar: 'a.png', chat_metadata: {
            sillynpc_system: 'A', sillynpc_npcs: [{ id: 'one', name: 'Mira' }, { id: 'two', name: 'Jon' }],
        } },
        { file_id: 'third', avatar: 'a.png', chat_metadata: {
            sillynpc_system: 'B', sillynpc_npcs: [{ id: 'three', name: 'Elsewhere' }],
        } },
    ];
    const sources = chatNpcSources(headers, 'A');
    assert.deepEqual(sources.map(({ char, sourceChat }) => [char.name, sourceChat]), [
        ['Mira', ':a.png:first'], ['Mira', ':a.png:second'], ['Jon', ':a.png:second'],
    ]);
});

test('portrait references in closed chats remain protected', () => {
    const headers = [{ chat_metadata: { sillynpc_npcs: [
        { imageUrl: '/user/images/a.png', images: ['/user/images/b.png'] },
    ] } }];
    assert.deepEqual(chatNpcImagePaths(headers), new Set([
        '/user/images/a.png', '/user/images/b.png',
    ]));
});
