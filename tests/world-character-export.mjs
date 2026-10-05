import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { chatNpcSources, CHAT_NPCS_KEY } from '../src/chat/chat-npc-sources.js';
import { npcTemplateFor } from '../src/core/npc-templates.js';
import { splitNpcStats, normaliseNpcPersistence } from '../src/tracker/stat-persistence.js';
import { normaliseStatUpdatePolicies } from '../src/tracker/stat-update-policy.js';
import { profileStrings } from '../src/core/profile-fields.js';

function hostIndependentSource(path) {
    return readFileSync(new URL(path, import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replaceAll('export ', '');
}

const transferSource = hostIndependentSource('../src/characters/character-transfer.js');
const exportSource = hostIndependentSource('../src/characters/world-character-export.js');

test('inactive System exports shared cards and chat NPCs using its own rules', async () => {
    const activeDefinition = { npcTemplates: [{ id: 'active' }], legacyNpcTemplateId: 'active' };
    const selectedDefinition = { npcTemplates: [{ id: 'scout' }], legacyNpcTemplateId: 'scout',
        stats: { npc: [{ name: 'Rank', type: 'number', updatePolicy: 'advancement' }] } };
    const settings = { activeSystem: 'Active', statusTracker: {
        npcStats: [{ name: 'Other', updatePolicy: 'advancement' }],
        presets: { Active: { definition: activeDefinition }, Inactive: { definition: selectedDefinition } },
    } };
    const cards = [{ id: 'shared', name: 'Mira', statusOverrides: { Rank: '3', Other: '9' } }];
    const headers = [{ file_id: 'story', chat_metadata: { sillynpc_system: 'Inactive',
        [CHAT_NPCS_KEY]: [{ id: 'chat', name: 'Tess', statusOverrides: { Rank: '2' } }],
    } }];
    const serialiseCharacter = new Function('getSettings', 'activeNpcSystem', 'npcTemplateFor',
        'splitNpcStats', 'profileStrings', 'loadWorldInfo', 'debugLog',
        `${transferSource}\nreturn serialiseCharacter;`)(
        () => settings, () => activeDefinition, npcTemplateFor, splitNpcStats,
        profileStrings, async () => null, () => {});
    const exportWorldCharacters = new Function('getSettings', 'getWorldCharacters',
        'getChatCharacters', 'getContext', 'listChatHeaders', 'chatNpcSources', 'CHAT_NPCS_KEY',
        'serialiseCharacter', 'TRANSFER_FORMAT', 'TRANSFER_VERSION',
        'normaliseStatUpdatePolicies', 'normaliseNpcPersistence',
        `${exportSource}\nreturn exportWorldCharacters;`)(
        () => settings, () => cards, () => [], () => ({}), async () => headers,
        chatNpcSources, CHAT_NPCS_KEY, serialiseCharacter, 'sillynpc-characters', 2,
        normaliseStatUpdatePolicies, normaliseNpcPersistence);

    const payload = await exportWorldCharacters('Inactive');
    assert.deepEqual(payload.characters.map(card => card.name), ['Mira', 'Tess']);
    assert.deepEqual(payload.characters.map(card => card.npcTemplateId), ['scout', 'scout']);
    assert.deepEqual(payload.characters[0].innateStats, { Rank: '3' });
    assert.deepEqual(payload.characters[1].innateStats, { Rank: '2' });
    assert.equal(payload.characters[0].source.kind, 'world');
    assert.equal(payload.characters[1].source.kind, 'chat');
});
