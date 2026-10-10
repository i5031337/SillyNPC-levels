import { getContext } from '../../../../../st-context.js';
import { getActiveCharacters } from '../characters/characters.js';
import { readDialogueRecords } from '../chat/dialogue-presentation.js';
import { parseVoiceCues, voiceCueKey } from './voice-cue-format.js';
import { makeId } from '../core/utils.js';

const KEY = 'sillynpc_voice_cues';

function cueStore(context = getContext()) {
    const metadata = context?.chatMetadata;
    if (!metadata || context?.getCurrentChatId?.() === undefined) return null;
    return metadata[KEY] && typeof metadata[KEY] === 'object' && !Array.isArray(metadata[KEY])
        ? metadata[KEY] : null;
}

/** Existing assignments are sticky; an edited or repeated cue cannot redesign a clone. */
export function saveVoiceCues(cues, context = getContext()) {
    if (!cues.length || !context?.chatMetadata || context?.getCurrentChatId?.() === undefined) return 0;
    const store = cueStore(context) || (context.chatMetadata[KEY] = {});
    let added = 0;
    for (const { speaker, description } of cues) {
        const key = voiceCueKey(speaker);
        if (Object.hasOwn(store, key)) continue;
        store[key] = { id: makeId(), description, version: 1 };
        added++;
    }
    if (added) context.saveMetadataDebounced?.();
    return added;
}

export function voiceCueFor(speaker, card = null, context = getContext()) {
    const store = cueStore(context);
    if (!store) return null;
    const names = card ? [card.name, ...(card.aliases || [])
        .filter(alias => alias && !alias.isRegex).map(alias => alias.pattern), speaker] : [speaker];
    for (const name of names) {
        const key = voiceCueKey(name);
        const cue = Object.hasOwn(store, key) ? store[key] : null;
        if (cue && /^[A-Za-z0-9_-]{1,100}$/u.test(cue.id) && typeof cue.description === 'string'
            && cue.description.trim() && cue.description.length <= 200 && !/[\r\n]/u.test(cue.description)
            && Number.isSafeInteger(cue.version) && cue.version > 0) return cue;
    }
    return null;
}

/** Manual card descriptions win; the provisional identity also works before a card exists. */
export function cardWithVoiceCue(card, speaker, context = getContext()) {
    if (card?.presentation?.voiceDesign?.description) return card;
    const cue = voiceCueFor(speaker, card, context);
    if (!cue) return card;
    return { ...card, id: cue.id, presentation: {
        ...card?.presentation, voiceDesign: { description: cue.description, version: cue.version },
    } };
}

/** Called only for a completed reply or deliberate manual replay, never history rendering. */
export function captureVoiceCues(messageId, context = getContext()) {
    const message = context?.chat?.[messageId];
    if (!message || message.is_user || message.is_system) return 0;
    const element = document.querySelector(`#chat .mes[mesid="${Number(messageId)}"]`);
    if (!element) return 0;
    const records = readDialogueRecords(element, { context, characters: getActiveCharacters() });
    return saveVoiceCues(parseVoiceCues(message.mes, records), context);
}
