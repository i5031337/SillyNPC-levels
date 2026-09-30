import { fnv1a } from '../core/hash.js';
import { LOG_PREFIX, BUILT_IN_DEFAULT_AVATAR, paletteColorFor, debugLog } from '../core/constants.js';
import { getSettings } from '../core/settings.js';
import { getContext } from '../../../../../st-context.js';
import { findCharacter, getActiveCharacters, getChatCast } from '../characters/characters.js';
import { getAllCharacters } from '../characters/character-repository.js';
import { personaFileFromAvatar } from '../core/utils.js';
import { processStatusUpdate, renderStatusTrackerBox, redrawStatusBoxes } from '../tracker/ui/status-ui.js';
import {
    registerActiveCharacter, reconcileScenePresence, resolvePersonaSpeaker,
    getPlayerImageUrl, getCurrentPersonaKey, getCastDecisions,
} from '../tracker/status-logic.js';
import { faceFor, faceAssignmentVersion } from '../characters/default-portraits.js';
import { getIgnoredSpeakerLabels, normaliseSpeakerLabel } from '../story/speaker-labels.js';
import { charactersMentionedIn } from '../story/mentions.js';
import { triggerReprocess, setReprocessCallback } from './reprocess.js';
import { updateHUD } from '../ui/hud/ui-hud.js';
import { getTrackerView, setTrackerView, nextTrackerView } from '../tracker/tracker-view.js';
import { eventSource } from '../../../../../events.js';
import { messageBeats, MESSAGE_RENDERED_EVENT } from '../story/beats.js';
import { chatRenderSignature } from './chat-signature.js';
import { applyPlayerPortrait, injectCharacterImages } from './chat-portraits.js';

function runReprocessLogic(mesEl) {
    if (!mesEl) return;
    try {
        // Wrap every step in a try-catch to ensure one failure doesn't block the whole chain.
        // Also use requestIdleCallback or defer if possible to avoid UI contention.
        
        try {
            addRefreshButtonToMessage(mesEl);
        } catch (e) { console.error(LOG_PREFIX, 'addRefreshButton failed', e); }

        try {
            addTrackerEyeToMessage(mesEl);
        } catch (e) { console.error(LOG_PREFIX, 'addTrackerEye failed', e); }

        mesEl.removeAttribute('data-sillynpc-status-hidden');
        
        const tasks = [
            { name: 'processStatusUpdate', fn: processStatusUpdate },
            { name: 'applyPlayerPortrait', fn: applyPlayerPortrait },
            { name: 'injectCharacterImages', fn: injectCharacterImages },
            { name: 'renderStatusTrackerBox', fn: renderStatusTrackerBox }
        ];

        for (const task of tasks) {
            try {
                if (typeof task.fn === 'function') {
                    task.fn(mesEl);
                }
            } catch (e) {
                console.error(LOG_PREFIX, `${task.name} failed`, e);
            }
        }

        /* This message is now readable: the avatars are placed, so messageBeats can say who
           speaks where. Anything reading a message rather than styling it has to wait for
           exactly this moment, and the alternatives are all guesses - a rAF that usually
           wins the race, or a MutationObserver over the whole chat.
           Fired per message, so a whole-chat redraw fires it many times; a listener that
           does real work should debounce. */
        eventSource.emit(MESSAGE_RENDERED_EVENT, mesEl);
    } catch (err) {
        console.error(LOG_PREFIX, 'reprocessMessage failed', err);
    }
}

export function reprocessMessage(mesEl) {
    if (!mesEl) return;
    
    // We use requestAnimationFrame to ensure we run after the browser has finished 
    // any current rendering tasks, which improves reliability for character styling.
    requestAnimationFrame(() => runReprocessLogic(mesEl));
}

let reprocessAllTimer = null;

/**
 * Coalesces the bursts of whole-chat reprocessing that fire when several of our
 * listeners (CHAT_CHANGED, CHARACTER_EDITED, sillynpc-status-updated, ...) land in
 * the same tick.
 */
/**
 * The signature the chat was last drawn with, so a redraw can decline.
 *
 * Null rather than an empty string: the first redraw of a session has to happen, and an
 * empty string is a signature a chat could legitimately have.
 *
 * @type {string|null}
 */
let lastDrawnSignature = null;

/** Forces the next redraw to run, whatever the signature says. */
export function invalidateChatRender() {
    lastDrawnSignature = null;
}

export function reprocessAllMessages() {
    if (reprocessAllTimer) clearTimeout(reprocessAllTimer);
    reprocessAllTimer = setTimeout(() => {
        reprocessAllTimer = null;

        // Six DOM operations per message, over every message in the chat - six hundred of
        // them on a chat of a hundred. It was worth paying whenever anything at all fired
        // one of our listeners; it is not worth paying when nothing that reaches the chat
        // has moved. Everything that genuinely changed still redraws at once, because the
        // signature says so.
        const signature = chatRenderSignature();
        if (signature === lastDrawnSignature) {
            debugLog('Reprocess skipped: nothing that reaches the chat changed');
            return;
        }
        lastDrawnSignature = signature;

        runReprocessAllNow();
    }, 150);
}

function runReprocessAllNow() {
    const messages = Array.from(document.querySelectorAll('#chat .mes'));
    if (messages.length === 0) return;
    
    // Improvement: Batch the processing using small groups to avoid blocking the main thread.
    // Use a single requestAnimationFrame to start the batch.
    requestAnimationFrame(() => {
        const CHUNK_SIZE = 5; // Process in small batches
        let index = 0;

        function processBatch() {
            const end = Math.min(index + CHUNK_SIZE, messages.length);
            for (; index < end; index++) {
                runReprocessLogic(messages[index]);
            }

            if (index < messages.length) {
                // Schedule next batch
                requestAnimationFrame(processBatch);
            }
        }

        processBatch();
    });
}

/**
 * What each state of the eye looks like and says it does.
 *
 * Font Awesome has no plain closed eye; fa-eye-low-vision is the one between open and
 * struck through, which is the order these are read in.
 */
export const TRACKER_EYE = {
    full: { icon: 'fa-eye', title: 'Tracker: showing everything. Click for world stats only.' },
    globals: { icon: 'fa-eye-low-vision', title: 'Tracker: world stats only. Click to hide it.' },
    hidden: { icon: 'fa-eye-slash', title: 'Tracker: hidden. Click to show it again.' },
};

/** Puts the eye in the state given, without rebuilding it. */
export function paintTrackerEye(btn, view) {
    const { icon, title } = TRACKER_EYE[view] || TRACKER_EYE.full;
    // mes_button so it looks and sizes like SillyTavern's own toolbar buttons, which
    // is where it now lives.
    btn.className = `mes_button sillynpc-tracker-eye fa-solid ${icon}`;
    btn.title = title;
    btn.dataset.view = view;
}

/**
 * The control that hides the tracker box.
 *
 * Deliberately not inside the box: the third state removes the box, and a switch that
 * disappears along with the thing it switches cannot be switched back.
 *
 * It lives in SillyTavern's own per-message toolbar, beside the refresh button this
 * extension already puts there. It spent its first version absolutely positioned in the
 * message's left margin, lined up with the swipe chevron by borrowing that chevron's
 * offsets - which is exact arithmetic against somebody else's layout, and read as a stray
 * icon floating in the margin on the stock theme.
 *
 * The toolbar sits behind SillyTavern's "Message Actions" ellipsis, so this is a step
 * further in than it was. That is the trade for a position that no theme can move.
 */
function addTrackerEyeToMessage(mesEl) {
    if (!getSettings().statusTracker?.enabled) {
        mesEl.querySelector('.sillynpc-tracker-eye')?.remove();
        return;
    }

    const toolbar = mesEl.querySelector('.extraMesButtons');
    if (!toolbar) return;

    const existing = mesEl.querySelector('.sillynpc-tracker-eye');
    if (existing) {
        // A redraw must not stack copies, and the one already here may be showing a
        // state from before the last click.
        paintTrackerEye(existing, getTrackerView());
        return;
    }

    const btn = document.createElement('div');
    paintTrackerEye(btn, getTrackerView());
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = nextTrackerView(getTrackerView());
        setTrackerView(next);
        // Every message's eye, not just this one: the others are only hidden by CSS, and
        // "show under every message" puts a box under each of them.
        document.querySelectorAll('.sillynpc-tracker-eye')
            .forEach(el => paintTrackerEye(el, next));
        redrawStatusBoxes();
    });

    toolbar.insertBefore(btn, toolbar.firstChild);
}

function addRefreshButtonToMessage(mesEl) {
    const toolbar = mesEl.querySelector('.extraMesButtons');
    if (!toolbar || toolbar.querySelector('.sillynpc-refresh-btn')) return;

    const btn = document.createElement('div');
    btn.className = 'mes_button sillynpc-refresh-btn fa-solid fa-arrows-rotate';
    btn.title = 'Refresh Tracking-bar and Chat';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // It used to re-parse this message for a <status_update> block and apply it. That
        // only ever worked in inline mode: with a separate extraction pass - the default -
        // messages carry no block, so the button did nothing but warn. Restoring an
        // earlier state has its own control on the player sheet, so this is what its name
        // says instead: draw the tracker and the chat decorations again.
        reprocessAllMessages();
        updateHUD();
        if (typeof toastr !== 'undefined') {
            toastr.info('Tracker and chat redrawn.', 'SillyNPC');
        }
    });
    toolbar.insertBefore(btn, toolbar.firstChild);
}
