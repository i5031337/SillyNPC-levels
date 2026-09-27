import { getContext } from '../../../../../st-context.js';
import { getSettings, saveSettings } from '../core/settings.js';
import { CHAT_NPCS_KEY } from '../chat/chat-npc-sources.js';
import { visibleCharacters } from './character-scope.js';

export { CHAT_NPCS_KEY };

/** Chat metadata is copied with a chat and deleted with it. */
export function getChatCharacters() {
    const context = getContext();
    if (context?.getCurrentChatId?.() === undefined) return [];
    const records = context.chatMetadata?.[CHAT_NPCS_KEY];
    return Array.isArray(records) ? records : [];
}

export function getWorldCharacters() {
    return getSettings().characters || [];
}

/** Full library, including reusable source cards shadowed by a chat NPC. */
export function getLibraryCharacters() {
    return [...getChatCharacters(), ...getWorldCharacters()];
}

/** A local NPC wins a same-name match in its chat. */
export function getAllCharacters() {
    return visibleCharacters(getChatCharacters(), getWorldCharacters());
}

export function findCharacterRecord(id) {
    return getLibraryCharacters().find(card => card.id === id) || null;
}

export function collectionForCharacter(id) {
    const chat = getChatCharacters();
    return chat.some(card => card.id === id) ? chat : getWorldCharacters();
}

export function isChatCharacter(id) {
    return getChatCharacters().some(card => card.id === id);
}

/** New cards belong to the open chat; without one they remain reusable world cards. */
export function addCharacterRecord(card, { world = false } = {}) {
    const context = getContext();
    if (!world && context?.getCurrentChatId?.() !== undefined && context.chatMetadata) {
        const records = getChatCharacters();
        if (!Array.isArray(context.chatMetadata[CHAT_NPCS_KEY])) {
            context.chatMetadata[CHAT_NPCS_KEY] = records;
        }
        records.push(card);
        context.saveMetadataDebounced?.();
        return 'chat';
    }
    getWorldCharacters().push(card);
    saveSettings();
    return 'world';
}

export function deleteCharacterRecord(id) {
    for (const records of [getChatCharacters(), getWorldCharacters()]) {
        const index = records.findIndex(card => card.id === id);
        if (index < 0) continue;
        records.splice(index, 1);
        if (records === getSettings().characters) saveSettings();
        else getContext()?.saveMetadataDebounced?.();
        return true;
    }
    return false;
}
