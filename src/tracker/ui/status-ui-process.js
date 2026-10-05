import { getAllCharacters } from '../../characters/character-repository.js';
import { queueInlineReading } from '../extractor/status-inline-grants.js';
import { getSettings } from '../../core/settings.js';
import { eventSource, event_types } from '../../../../../../events.js';
import { parseMessageForUpdates } from '../status-logic.js';
import { extractJSON, safeJsonParse } from '../../core/utils.js';
import { debugLog } from '../../core/constants.js';
import { stripAndPersist } from '../status-history.js';
import { hideStatusDataSurgically } from './status-ui-hidden.js';
import { renderStatusTrackerBox } from './status-ui-box.js';
import { insideTracker, isEditingInside } from './status-ui-guards.js';


const processingMessages = new Set();

/**
 * Live MutationObservers, keyed by message id.
 *
 * These used to be created per message and guarded only by a DOM attribute, with
 * nothing ever disconnecting them -- so they accumulated for the lifetime of the tab
 * and kept observing detached nodes after a chat switch. Tracking them here lets
 * disconnectStatusObservers() tear them all down on CHAT_CHANGED.
 *
 * @type {Map<string, MutationObserver>}
 */
const statusObservers = new Map();

/**
 * Disconnects and forgets every per-message observer. Called on chat change.
 */
function disconnectStatusObservers() {
    for (const observer of statusObservers.values()) {
        observer.disconnect();
    }
    statusObservers.clear();
    processingMessages.clear();
}

// A chat switch replaces every message node, so the observers watching the old
// ones are pure garbage. Handled here rather than in status-logic.js to avoid an
// import cycle between the two modules.
eventSource.on(event_types.CHAT_CHANGED, disconnectStatusObservers);

/**
 * Whether a reply is streaming in right now.
 *
 * The observers below watch `.mes_text` with `subtree` and `characterData`, which is
 * exactly what streaming changes - so every token arriving rebuilt that message's tracker
 * box, and the next token threw the result away. That is most of what made generating feel
 * like the whole app was stuttering.
 *
 * The box is drawn once when the message finishes, by the CHARACTER_MESSAGE_RENDERED
 * handler that already runs, so nothing is lost by staying quiet until then.
 */
let streaming = false;
eventSource.on(event_types.GENERATION_STARTED, () => { streaming = true; });
for (const done of [event_types.GENERATION_ENDED, event_types.GENERATION_STOPPED]) {
    eventSource.on(done, () => { streaming = false; });
}

/**
 * Hides the "Reasoning:" prefix line that may appear before the status update element.
 * Walks backward from the given DOM node to find and truncate/hide it.
 * @param {Node} refNode  The status_update element or the first hidden text node.
 */
function hideReasoningPrefixBefore(refNode) {
    let node = refNode.previousSibling;
    while (node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const t = node.nodeValue;
            // Find a "Reasoning:" that starts a line near the end of this text node
            const m = t.match(/((?:\n|^)\s*Reasoning\s*:[\s\S]*)$/i);
            if (m) {
                node.nodeValue = t.substring(0, t.length - m[0].length).replace(/\s+$/, '');
            }
            break;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (/reasoning\s*:/i.test(node.textContent)) {
                node.style.display = 'none';
                node.setAttribute('data-sillynpc-hidden', 'true');
            }
            break;
        }
        node = node.previousSibling;
    }
}

/**
 * Processes a message for status updates and hides the raw data.
 * Called BEFORE character image injection to ensure DOM stability.
 * @param {Element} mesEl 
 */
export function processStatusUpdate(mesEl) {
    const mesId = mesEl.getAttribute('mesid');
    if (!mesId || mesEl.closest('#welcome-message')) return;
    if (processingMessages.has(mesId)) return;

    const settings = getSettings().statusTracker;
    if (!settings.enabled) return;

    const textContainer = mesEl.querySelector('.mes_text');
    if (!textContainer) return;

    const isUser = mesEl.classList.contains('user_mes');
    if (isUser) return;

    // Setup MutationObserver to watch for content changes (e.g., during streaming or post-generation DOM updates)
    if (!statusObservers.has(mesId)) {
        textContainer.setAttribute('data-sillynpc-observed', 'true');
        let queued = false;
        const observer = new MutationObserver((records) => {
            // The tracker box is drawn inside .mes_text, so it is inside what this
            // watches. A change originating in it is never new message content: it is
            // either this function's own redraw, or somebody typing into an editable
            // cell - and rebuilding on that destroys the element being typed into, which
            // is why a field took one character per click and the whole box was rebuilt
            // on every keystroke.
            if (records.every(record => insideTracker(record.target))) return;

            // Not while the reply is still arriving. Every token mutates this subtree, and
            // rebuilding for one is work the next one discards.
            if (streaming) return;

            // One rebuild per frame however many mutations land in it. A paste or an edit
            // arrives as a burst, and this used to rebuild once per batch.
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                observer.disconnect();
                try {
                    processStatusUpdate(mesEl);
                    renderStatusTrackerBox(mesEl);
                } finally {
                    observer.observe(textContainer, { childList: true, subtree: true, characterData: true });
                }
            });
        });
        observer.observe(textContainer, { childList: true, subtree: true, characterData: true });
        statusObservers.set(mesId, observer);
    }

    // Not while somebody is typing in the box on this message.
    //
    // The first line of the block below takes the box out, and renderStatusTrackerBox -
    // which is what puts it back - declines to run during an edit, so the two disagreed:
    // any redraw landing mid-edit removed the box and then left it removed. That is worse
    // than the rebuild the edit guard was added to prevent, and it is why editing a world
    // stat broke again.
    //
    // Returning rather than guarding only the removal, because the surgery further down
    // measures offsets into textContent and the box's own text would be inside them. The
    // observer above is already registered by this point, and a message being typed into
    // has been processed before or there would be no box to type into.
    if (isEditingInside(mesEl) || streaming || mesEl.classList.contains('writing')) return;

    processingMessages.add(mesId);
    try {
        // Remove existing status tracker UI before reading textContent
        mesEl.querySelectorAll('.sillynpc-status-tracker-container').forEach(el => el.remove());

        // ── STRATEGY 1: Regex match on raw textContent (covers plain-text <status_update> tags) ──
        const text = textContainer.textContent;
        const { cleanedText, update: textUpdate, matchLength: textMatchLength } = parseMessageForUpdates(text);

        // Keep a status-only reply visible. The same guard in status-history.js
        // protects the saved text; this protects its already rendered DOM.
        if (textMatchLength > 0 && cleanedText?.trim()) {
            const isWriting = mesEl.classList.contains('writing');
            if (!textUpdate && isWriting) {
                return;
            }

            const hasNewContent = !mesEl.hasAttribute('data-sillynpc-last-update-text') || mesEl.getAttribute('data-sillynpc-last-update-text') !== text;
            if (settings.extractionMode !== 'manual' && textUpdate
                && (!mesEl.hasAttribute('data-sillynpc-status-applied') || hasNewContent)) {
                queueInlineReading(textUpdate, mesId, mesEl, text);
                mesEl.setAttribute('data-sillynpc-status-applied', 'true');
                mesEl.setAttribute('data-sillynpc-last-update-text', text);
            }
            hideStatusDataSurgically(textContainer, textMatchLength);
            mesEl.setAttribute('data-sillynpc-status-hidden', 'true');
            // Take it out of the stored message too, not just the DOM: otherwise it is
            // saved to the chat and re-sent on every later turn.
            stripAndPersist(mesId);
            return;
        }

        // ── STRATEGY 2: Browser parsed <status_update> as a DOM element ──
        // When the markdown engine treats it as an unknown HTML tag, the literal
        // "<status_update>" string is absent from textContent, so the regex above fails.
        // We find the element directly and hide it in-place.
        const statusTagEl = textContainer.querySelector('status_update');
        if (statusTagEl) {
            debugLog('Found status_update as DOM element — hiding directly');
            const jsonStr = extractJSON(statusTagEl.textContent);
            const parsedUpdate = safeJsonParse(jsonStr);

            const isWriting = mesEl.classList.contains('writing');
            if (!parsedUpdate && isWriting) {
                return;
            }

            if (parsedUpdate && (parsedUpdate.global !== undefined || parsedUpdate.player !== undefined || parsedUpdate.characters !== undefined)) {
                const hasNewContent = !mesEl.hasAttribute('data-sillynpc-last-update-text') || mesEl.getAttribute('data-sillynpc-last-update-text') !== statusTagEl.textContent;
                if (settings.extractionMode !== 'manual'
                    && (!mesEl.hasAttribute('data-sillynpc-status-applied') || hasNewContent)) {
                    queueInlineReading(parsedUpdate, mesId, mesEl, statusTagEl.textContent);
                    mesEl.setAttribute('data-sillynpc-status-applied', 'true');
                    mesEl.setAttribute('data-sillynpc-last-update-text', statusTagEl.textContent);
                }
            }

            if (!textContainer.textContent.replace(statusTagEl.textContent, '').trim()) return;

            // Always hide the element directly — no offset math needed
            statusTagEl.style.display = 'none';
            statusTagEl.setAttribute('data-sillynpc-hidden', 'true');

            // Hide any "Reasoning:" prefix that precedes the element
            hideReasoningPrefixBefore(statusTagEl);

            mesEl.setAttribute('data-sillynpc-status-hidden', 'true');
            return;
        }

        // ── STRATEGY 3: Robust JSON root scan (fallback for untagged AI output) ──
        // The previous fallback used lastIndexOf('{', keyPos) which finds a *nested* '{',
        // not the root '{'. We now scan backward through all candidate '{' positions
        // until we find one that produces a valid root-level update object.
        const rootKeys = ['"global"', "'global'", '"player"', "'player'", '"characters"', "'characters'"];
        let earliestKeyIdx = Infinity;
        for (const key of rootKeys) {
            // Use indexOf (first occurrence) to find the outermost JSON key
            const idx = text.indexOf(key);
            if (idx !== -1 && idx < earliestKeyIdx) {
                earliestKeyIdx = idx;
            }
        }

        if (earliestKeyIdx !== Infinity) {
            // Scan backward from the earliest root key to find the true root '{'
            let searchPos = earliestKeyIdx;
            let foundUpdate = false;
            while (searchPos >= 0) {
                const bracePos = text.lastIndexOf('{', searchPos);
                if (bracePos === -1) break;

                const candidate = text.substring(bracePos);
                const extractedJson = extractJSON(candidate);
                const parsedCandidate = safeJsonParse(extractedJson);

                if (parsedCandidate && (parsedCandidate.global !== undefined || parsedCandidate.player !== undefined || parsedCandidate.characters !== undefined)) {
                    // Found a valid root-level update
                    foundUpdate = true;
                    const hasNewContent = !mesEl.hasAttribute('data-sillynpc-last-update-text') || mesEl.getAttribute('data-sillynpc-last-update-text') !== extractedJson;
                    if (settings.extractionMode !== 'manual'
                        && (!mesEl.hasAttribute('data-sillynpc-status-applied') || hasNewContent)) {
                        queueInlineReading(parsedCandidate, mesId, mesEl, extractedJson);
                        mesEl.setAttribute('data-sillynpc-status-applied', 'true');
                        mesEl.setAttribute('data-sillynpc-last-update-text', extractedJson);
                    }
                    // Compute matchLength from bracePos, accounting for Reasoning: prefix
                    let startHideIndex = bracePos;
                    const prefix = text.substring(0, bracePos);
                    const reasoningRegex = /(?:\n|^)\s*Reasoning\s*:[\s\S]*$/gi;
                    const rm = prefix.match(reasoningRegex);
                    if (rm) {
                        const lastRmIdx = prefix.lastIndexOf(rm[rm.length - 1]);
                        const dist = prefix.length - lastRmIdx;
                        if (dist < 1000 && (dist + (text.length - bracePos)) < text.length * 0.8) {
                            startHideIndex = lastRmIdx;
                        }
                    }
                    if (!text.substring(0, startHideIndex).trim()) return;
                    hideStatusDataSurgically(textContainer, text.length - startHideIndex);
                    mesEl.setAttribute('data-sillynpc-status-hidden', 'true');
                    stripAndPersist(mesId);
                    return;
                }

                // Move search start back to before this brace
                searchPos = bracePos - 1;
            }

            // If we are still writing and haven't successfully parsed/applied an update yet,
            // return without hiding or setting hidden. Let it continue streaming!
            if (!foundUpdate && mesEl.classList.contains('writing')) {
                return;
            }
        }

    } finally {
        processingMessages.delete(mesId);
    }
}
