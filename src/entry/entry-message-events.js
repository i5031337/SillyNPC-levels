import { getContext } from '../../../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { LOG_PREFIX, debugLog } from '../core/constants.js';
import { reprocessMessage } from '../chat/chat.js';
import { extractStateFromMessage, forgetExtractionsFrom } from '../tracker/extractor/status-extractor.js';
import { rebaseToSwipe, revertToBase } from '../tracker/snapshots/status-snapshots.js';

export function onMessageRendered(messageId) {
    try {
        const mesEl = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        reprocessMessage(mesEl);

        // If "showOnlyAtBottom" is enabled, we need to reprocess the previous message
        // to ensure its tracker is removed now that there's a new message.
        if (getSettings().statusTracker?.showOnlyAtBottom) {
            const prevMesId = Number(messageId) - 1;
            if (prevMesId >= 0) {
                const prevMesEl = document.querySelector(`#chat .mes[mesid="${prevMesId}"]`);
                if (prevMesEl) reprocessMessage(prevMesEl);
            }
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
    try {
        const context = getContext();
        const message = context?.chat?.[Number(messageId)];
        // Only the model's own prose is worth reading; user turns and system notes
        // describe nothing that changed.
        if (!message || message.is_user || message.is_system) return;

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

/**
 * The tracker follows the swipe, then the message is redrawn.
 *
 * The changes already applied describe the reply that was on screen a moment ago. Left
 * alone, the story continues from numbers that belong to a reply the user swiped away
 * from - silently, which is what made this worth fixing rather than living with.
 */
export function onSwipe(messageId) {
    try {
        const result = rebaseToSwipe(messageId);
        if (!result.rebased && result.reason === 'no base') {
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
 * The tracker follows a Regenerate, which is not a swipe.
 *
 * Regenerate deletes the newest reply and writes another in its place. SillyTavern says so
 * only by emitting MESSAGE_DELETED - MESSAGE_SWIPED comes from the swipe arrows alone - and
 * the payload there is the new chat length, which is identical whether the tail or the
 * middle was removed. So the generation type is what this reads instead: it is unambiguous,
 * and it arrives before the truncation, while the doomed message is still the last one.
 *
 * Two things have to happen, and neither used to. The changes that reply applied are undone,
 * or the replacement stacks on top of a reply nobody can see. And the guard that remembers
 * which messages have been read has to forget this index, because the replacement lands on
 * the same number and would otherwise be waved through as already extracted - which is why
 * the numbers did not merely drift after a Regenerate, they stopped moving entirely.
 */
export function onRegenerateStarted(type, _data, dryRun) {
    if (dryRun || type !== 'regenerate') return;
    try {
        const messageId = (getContext()?.chat?.length ?? 0) - 1;
        if (messageId < 0) return;

        forgetExtractionsFrom(messageId);
        const result = revertToBase(messageId);
        if (!result.reverted && result.reason === 'no base') {
            // Same reasoning as the swipe path: never a silent disagreement between the
            // tracker and the reply on screen.
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
 * Stale guard entries are dropped whenever messages go away.
 *
 * Message ids are positions, not identities, so anything from here on is a number that will
 * be handed to a different message later. Only the forgetting is safe to do here: the
 * payload cannot distinguish deleting the last message from deleting one in the middle, and
 * reverting the wrong one would discard state silently. See the regenerate handler above,
 * which knows exactly what it is undoing.
 */
export function onMessageDeleted(newLength) {
    try {
        forgetExtractionsFrom(newLength);
    } catch (err) {
        console.error(LOG_PREFIX, 'onMessageDeleted error', err);
    }
}

