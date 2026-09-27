import { getContext } from '../../../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { LOG_PREFIX, debugLog } from '../core/constants.js';
import { noteHistory, noteFieldNames, stripWorldNote } from '../story/history-notes.js';
import { promptText } from '../prompts/prompt-texts.js';

/**
 * SillyTavern's generation interceptor, named in manifest.json.
 *
 * Called with a copy of the history just before the prompt is built, and only for a story
 * generation - never for a dry run, and never for the tracker's own request. Each message
 * carries its own world snapshot, which is what the note is made of; see history-notes.js.
 *
 * It never aborts and never throws outward: a note is not worth losing a reply over.
 */
globalThis.sillyNpcHistoryNotes = function sillyNpcHistoryNotes(chat) {
    try {
        const tracker = getSettings().statusTracker;
        if (!tracker?.enabled || !tracker.historyNotes) return;
        const added = noteHistory(chat, {
            names: noteFieldNames(tracker),
            render: (fields) => promptText('historyNote', { fields }),
        });
        if (added) debugLog(`World notes on ${added} messages of the history`);
    } catch (err) {
        console.warn(LOG_PREFIX, 'Could not put the world notes on the history', err);
    }
};

/**
 * Takes a copied world note off a reply that starts with one.
 *
 * Told not to write them, a model still copies the shape it has just read on forty
 * messages. Removed here instead: before the message is drawn (MESSAGE_RECEIVED) and again
 * once it is (CHARACTER_MESSAGE_RENDERED), because a streamed reply skips the first.
 *
 * @param {string|number} messageId
 * @param {boolean} redraw Whether the message is already on screen.
 */
export function dropCopiedWorldNote(messageId, redraw) {
    try {
        const tracker = getSettings().statusTracker;
        if (!tracker?.enabled || !tracker.historyNotes) return;
        const context = getContext();
        const message = context?.chat?.[Number(messageId)];
        if (!message || message.is_user) return;
        if (!stripWorldNote(message, noteFieldNames(tracker))) return;

        debugLog(`Took a copied world note off message ${messageId}`);
        if (redraw) context.updateMessageBlock?.(Number(messageId), message);
        context.saveChat?.();
    } catch (err) {
        console.warn(LOG_PREFIX, 'Could not take the copied world note off the reply', err);
    }
}

