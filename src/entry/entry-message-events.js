import { getSettings } from '../core/settings.js';
import { getContext } from '../../../../../st-context.js';
import { LOG_PREFIX, debugLog } from '../core/constants.js';
import { reprocessMessage } from '../chat/chat.js';
import { extractStateFromMessage, forgetExtractionsFrom } from '../tracker/extractor/status-extractor.js';
import { clearExtractionReport } from '../tracker/extractor/status-extraction-report.js';
import { rebaseToSwipe, revertToBase, clearTurnRecord } from '../tracker/snapshots/status-snapshots.js';
import { swipeBaseRecord } from '../tracker/status-logic.js';
import { isImageOnlyMessage, trackerMessageIndex } from '../tracker/ui/status-ui-placement.js';

export function onMessageRendered(messageId) {
    try {
        const mesEl = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        reprocessMessage(mesEl);

        const chat = getContext()?.chat || [];
        if (isImageOnlyMessage(chat[Number(messageId)])) {
            // Image-only messages hide their text. The tracker belongs on the last
            // visible prose message, which needs a redraw after this new message lands.
            const anchorId = trackerMessageIndex(chat);
            const anchor = document.querySelector(`#chat .mes[mesid="${anchorId}"]`);
            if (anchor) reprocessMessage(anchor);
            return;
        }

        // A new prose message takes the tracker from the previous visible prose
        // message, which may be several indexes back after generated images.
        const id = Number(messageId);
        if (id === trackerMessageIndex(chat)) {
            const previousId = trackerMessageIndex(chat.slice(0, id));
            const previous = document.querySelector(`#chat .mes[mesid="${previousId}"]`);
            if (previous) reprocessMessage(previous);
        }
    } catch (err) {
        console.error(LOG_PREFIX, 'onMessageRendered error', err);
    }
}

/**
 * Runs the state-extraction pass for a freshly rendered AI message.
 *
 * Deliberately fire-and-forget: the reply is already on screen, and a slow or failing
 * extraction must never block reading it or throw into SillyTavern's event loop.
 */
export function onMessageForExtraction(messageId) {
    if (!getSettings().enabled) return;
    try {
        const context = getContext();
        const message = context?.chat?.[Number(messageId)];
        // Only the model's own prose is worth reading; user turns and system notes
        // describe nothing that changed.
        if (!message || message.is_user || message.is_system || isImageOnlyMessage(message)) return;

        extractStateFromMessage(message.mes, messageId)
            .then(result => {
                if (!result.applied && result.reason && result.reason !== 'extraction disabled'
                    && result.reason !== 'already extracted') {
                    debugLog('Extraction skipped:', result.reason);
                }
            })
            .catch(err => console.error(LOG_PREFIX, 'Extraction pass failed', err));
    } catch (err) {
        console.error(LOG_PREFIX, 'onMessageForExtraction error', err);
    }
}

/** Restore the selected swipe’s tracker state before redrawing the message. */
export function onSwipe(messageId) {
    if (!getSettings().enabled) return;
    try {
        // Over-swiping keeps the outgoing text and extra until generation starts.
        // The new slot is beyond the saved replies even when mes is still nonempty.
        const incoming = getContext()?.chat?.[Number(messageId)];
        const newSlot = Array.isArray(incoming?.swipes)
            && Number(incoming.swipe_id) >= incoming.swipes.length;
        if (incoming && (newSlot || !String(incoming.mes ?? '').trim())) clearTurnRecord(messageId);
        const result = rebaseToSwipe(messageId);
        if (!result.rebased) {
            // Never a silent disagreement between the tracker and the reply on screen.
            toastr.warning(
                'The tracker could not follow that swipe, so it may not match this reply.',
                'SillyNPC');
        }
    } catch (err) {
        console.error(LOG_PREFIX, 'onSwipe error', err);
    }
    onMessageRendered(messageId);
}

/**
 * Undo the latest reply before regeneration and allow its replacement to be extracted.
 * GENERATION_STARTED identifies regeneration before MESSAGE_DELETED truncates the chat.
 */
export function onRegenerateStarted(type, _data, dryRun) {
    if (!getSettings().enabled) return;
    if (dryRun || type !== 'regenerate') return;
    try {
        const messageId = (getContext()?.chat?.length ?? 0) - 1;
        if (messageId < 0) return;

        forgetExtractionsFrom(messageId);
        clearExtractionReport(messageId);
        const result = revertToBase(messageId);
        if (!result.reverted && result.reason === 'no base') {
            toastr.warning(
                'The tracker could not undo the reply being regenerated, so it may not '
                + 'match the new one.',
                'SillyNPC');
        }
    } catch (err) {
        console.error(LOG_PREFIX, 'onRegenerateStarted error', err);
    }
}

/**
 * Forget deleted extraction indexes and undo a removed tracked turn.
 * MESSAGE_DELETED supplies the new chat length, so the turn id determines whether
 * the tracked reply survived; a middle deletion requires manual review.
 */
export function onMessageDeleted(newLength) {
    if (!getSettings().enabled) return;
    try {
        forgetExtractionsFrom(newLength);
        const base = swipeBaseRecord();
        if (!base || Number(base.messageId) < Number(newLength) || !base.turnId) return;
        const survives = (getContext()?.chat || []).some(message =>
            message?.extra?.sillynpc_turn_id === base.turnId);
        if (!survives) revertToBase(base.messageId);
        else toastr.warning(
            'An earlier message was deleted. Review the tracker before continuing.', 'SillyNPC');
    } catch (err) {
        console.error(LOG_PREFIX, 'onMessageDeleted error', err);
    }
}

/** Re-reads an edited latest assistant reply from its pre-turn state. */
export function onMessageEdited(messageId) {
    if (!getSettings().enabled) return;
    const context = getContext();
    const id = Number(messageId);
    const message = context?.chat?.[id];
    if (!message || id !== context.chat.length - 1 || message.is_user || message.is_system) return;
    const result = revertToBase(id);
    if (!result.reverted) {
        toastr.warning('The tracker could not rebase this edited reply.', 'SillyNPC');
        return;
    }
    clearTurnRecord(id);
    forgetExtractionsFrom(id);
    clearExtractionReport(id);
    onMessageForExtraction(id);
}
