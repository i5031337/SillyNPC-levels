import { getContext } from '../../../../../../st-context.js';
import { getSettings } from '../../core/settings.js';
import { LOG_PREFIX } from '../../core/constants.js';
import { makeActivatable } from '../../core/utils.js';
import { extractStateFromMessage } from '../../tracker/extractor/status-extractor.js';
import { getSwipeBase } from '../../tracker/status-logic.js';
import { trackerMessageIndex } from '../../tracker/ui/status-ui-placement.js';

const BUTTON_ID = 'sillynpc-read-button';

/** Manual reading stays available during play, beside the history scan. */
export function refreshReadButton() {
    const settings = getSettings().statusTracker;
    if (!settings.enabled || settings.extractionMode !== 'manual') {
        document.getElementById(BUTTON_ID)?.remove();
        return;
    }
    if (document.getElementById(BUTTON_ID)) return;
    const host = document.getElementById('leftSendForm');
    if (!host) return;
    const button = document.createElement('div');
    button.id = BUTTON_ID;
    button.className = 'fa-solid fa-book-open interactable sillynpc-scan-button';
    button.tabIndex = 0;
    button.title = 'Read latest reply — update the tracker manually.';
    makeActivatable(button);
    button.addEventListener('click', onReadClicked);
    host.appendChild(button);
}

async function onReadClicked() {
    const button = document.getElementById(BUTTON_ID);
    const settings = getSettings().statusTracker;
    if (!button || button.classList.contains('sillynpc-scanning')
        || !settings.enabled || settings.extractionMode !== 'manual') return;
    const chat = getContext()?.chat || [];
    const messageId = trackerMessageIndex(chat);
    const message = chat[messageId];
    if (!message || message.is_user || message.is_system || !String(message.mes ?? '').trim()) {
        toastr.info('Wait for an assistant reply before reading the tracker.', 'SillyNPC');
        return;
    }
    button.classList.add('sillynpc-scanning');
    button.setAttribute('aria-busy', 'true');
    try {
        // Replace a previous reading from its pre-turn state, so XP is paid only once.
        const result = await extractStateFromMessage(message.mes, messageId, {
            manual: true, regenerate: Boolean(getSwipeBase(messageId)),
        });
        if (result.applied) {
            toastr.success(result.pending
                ? `Tracker read: ${result.pending} changes awaiting review.`
                : 'Tracker reading complete.', 'SillyNPC');
        } else {
            toastr.info(`Tracker did not run: ${result.reason || 'no update'}.`, 'SillyNPC');
        }
    } catch (err) {
        console.error(LOG_PREFIX, 'Manual tracker reading failed', err);
        toastr.error(String(err?.message || err), 'SillyNPC');
    } finally {
        button.classList.remove('sillynpc-scanning');
        button.removeAttribute('aria-busy');
    }
}
