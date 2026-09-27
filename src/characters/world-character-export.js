import { getContext } from '../../../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { getWorldCharacters, getChatCharacters } from './character-repository.js';
import { chatNpcSources, CHAT_NPCS_KEY } from '../chat/chat-npc-sources.js';
import { serialiseCharacter, TRANSFER_FORMAT, TRANSFER_VERSION } from './character-transfer.js';
import { listChatHeaders } from '../chat/chat-listing.js';
import { normaliseNpcPersistence } from '../tracker/stat-persistence.js';

export async function exportWorldCharacters(systemName) {
    const settings = getSettings();
    const profile = settings.statusTracker.presets?.[systemName];
    if (!profile) throw new Error(`Unknown System: ${systemName}`);

    const active = settings.activeSystem === systemName;
    const npcStats = structuredClone(active
        ? settings.statusTracker.npcStats
        : (profile.config?.statusTracker?.npcStats || profile.config?.npcStats || []));
    normaliseNpcPersistence(npcStats);
    const worldCards = active ? getWorldCharacters() : (profile.world?.characters || []);
    const headers = await listChatHeaders();

    // The current chat may contain debounced edits that have not reached its file yet.
    const context = getContext();
    const currentChatId = context?.getCurrentChatId?.();
    if (currentChatId !== undefined && context.chatMetadata?.sillynpc_system === systemName) {
        const current = {
            file_id: currentChatId,
            avatar: context.characters?.[context.characterId]?.avatar || '',
            group: context.groupId || '',
            chat_metadata: { ...context.chatMetadata, [CHAT_NPCS_KEY]: getChatCharacters() },
        };
        const at = headers.findIndex(header =>
            (header.file_id === currentChatId && (!current.group || header.group === current.group))
            || (context.chatMetadata?.integrity
                && header.chat_metadata?.integrity === context.chatMetadata.integrity));
        if (at >= 0) headers[at] = { ...headers[at], chat_metadata: current.chat_metadata };
        else headers.push(current);
    }

    const characters = [];
    for (const char of worldCards) {
        characters.push({
            ...await serialiseCharacter(char, { npcStats }),
            source: { kind: 'world', system: systemName, npcId: char.id },
        });
    }
    for (const { char, sourceChat } of chatNpcSources(headers, systemName)) {
        characters.push({
            ...await serialiseCharacter(char, { npcStats }),
            source: { kind: 'chat', system: systemName, chat: sourceChat, npcId: char.id },
        });
    }
    return { format: TRANSFER_FORMAT, version: TRANSFER_VERSION,
        exported: new Date().toISOString(), system: systemName, characters };
}
