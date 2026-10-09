import { getContext } from '../../../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { getActiveCharacters } from '../characters/characters.js';
import { getIgnoredSpeakerLabels } from '../story/speaker-labels.js';
import { resolvePersonaSpeaker } from '../tracker/status-logic.js';
import { dialogueContentClone, discoverDialogueLines } from './dialogue-discovery.js';

/** Exact content identity for cancellation and caches; does not rely on a hash collision. */
export function dialogueRevision(context, messageId) {
    const message = context?.chat?.[messageId];
    return JSON.stringify([
        context?.getCurrentChatId?.() ?? context?.chatId ?? null,
        context?.groupId ?? null, context?.characterId ?? null, messageId,
        message?.swipe_id ?? null, message?.mes ?? null, message?.extra?.display_text ?? null,
    ]);
}

/** Read dialogue only. Callers decide whether to classify or play it; reads have no side effects. */
export function readDialogueRecords(mesEl, {
    context = getContext(), characters = getActiveCharacters(), settings = getSettings(),
    ignoredLabels = getIgnoredSpeakerLabels(), personaFor = resolvePersonaSpeaker,
} = {}) {
    const container = mesEl?.querySelector('.mes_text');
    const id = mesEl?.getAttribute('mesid');
    const messageId = id === null || id === undefined || id === '' ? null : Number(id);
    if (!container || !Number.isInteger(messageId) || messageId < 0) return [];
    const revision = dialogueRevision(context, messageId);
    return discoverDialogueLines(dialogueContentClone(container), {
        characters, caseInsensitive: settings.caseInsensitive, ignoredLabels, personaFor,
    }).flatMap(({ label, card, persona, dialogue }, lineIndex) => {
        if (!dialogue?.text) return [];
        return [{
            messageId, revision, lineIndex,
            npcId: persona ? null : card?.id || null,
            displayName: persona?.name || card?.name || label.name,
            speakerLabel: label.name,
            isPersona: Boolean(persona),
            text: dialogue.text,
            quotedText: dialogue.quotedText,
        }];
    });
}
