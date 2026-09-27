import { getSettings } from '../../core/settings.js';
import { getContext } from '../../../../../../st-context.js';
import { eventSource } from '../../../../../../events.js';
import { loadStateFromMetadata, undoLastChange, getHistoryEntries } from '../status-logic.js';
import { makeActivatable } from '../../core/utils.js';
import { LOG_PREFIX } from '../../core/constants.js';
import { renderReviewPanel } from '../../ui/tracker/ui-change-review.js';
import { stateAtMessage } from '../snapshots/status-snapshots.js';
import { getTrackerView } from '../tracker-view.js';
import { openCastPanel } from '../../ui/characters/ui-cast-panel.js';
import { isEditingInside } from './status-ui-guards.js';
import { hasVisibleContent } from './status-ui-hidden.js';
import { buildStatusHtml } from './status-ui-template.js';
import { showAddCharacterDropdown } from './status-ui-menu.js';
import { attachInlineEditListeners } from './status-ui-edit.js';
import { renderExtractionReport } from './status-ui-report.js';

/**
 * Draws the tracker box again on every message, and nothing else.
 *
 * For a change to what is *shown* - the eye - rather than to what is tracked.
 * reprocessAllMessages() is the other option and does far more: it re-runs the speaker
 * decoration and the avatar injection over the whole chat, which a view toggle has no
 * business paying for.
 */
export function redrawStatusBoxes() {
    document.querySelectorAll('#chat .mes').forEach(mesEl => {
        try {
            renderStatusTrackerBox(mesEl);
        } catch (err) {
            console.error(LOG_PREFIX, 'redrawStatusBoxes failed for a message', err);
        }
    });
}

/**
 * Gives a tracker box the Tracker Text Size setting.
 *
 * Its own scale, separate from the menus'. This box sits in the middle of the story and
 * competes with the prose around it, so somebody who wants it out of the way usually does
 * not want the settings panels shrunk to match.
 *
 * A function rather than three lines inline, because the chat is not the only thing that
 * draws this box. The visual novel stage builds the same box from the same builder, and
 * while the scale lived inline here the stage never applied it - the slider moved every
 * box in the chat and left the one on the stage exactly as it was.
 *
 * @param {HTMLElement} box A `.sillynpc-status-box`.
 */
export function applyTrackerScale(box) {
    if (!box) return;
    const trackerScale = Number(getSettings().trackerFontScale);
    box.style.setProperty('--sillynpc-font-scale',
        String(Number.isFinite(trackerScale) && trackerScale > 0 ? trackerScale : 1));
}

/**
 * Lays a box's characters out in columns, when the setting asks for it.
 *
 * The columns are as wide as the widest character's row would be on one line, capped at
 * the box, and the grid fits as many of those as the width allows. So a scene of short
 * rows gets several columns and one long row gets one - which is the point: the width is
 * used without cutting anybody's line in half.
 *
 * Measured on the next frame, because a box that has only just been built is not in the
 * page and has no widths. A box that still is not (a hidden message) keeps a fallback
 * column width from the stylesheet.
 *
 * @param {HTMLElement} box A `.sillynpc-status-box`.
 */
export function fitCharacterColumns(box) {
    if (!box || !getSettings().statusTracker?.characterColumns) return;
    box.classList.add('sillynpc-char-columns');

    let measured = false;
    const measure = () => {
        if (measured) return;
        measured = true;
        const list = box.querySelector('.sillynpc-status-characters');
        const rows = list ? [...list.querySelectorAll('.sillynpc-status-char')] : [];
        if (!list || rows.length === 0 || !box.isConnected) return;

        list.classList.add('is-measuring');
        const widest = Math.max(...rows.map(row => row.getBoundingClientRect().width));
        list.classList.remove('is-measuring');

        if (widest > 0) list.style.setProperty('--sillynpc-char-column', `${Math.ceil(widest)}px`);
    };
    /* A frame, so it lands before the box is first painted - and a timer as well, because a
       window in the background gets no frames at all, and a box measured only on a frame
       would keep the fallback width until the next redraw. Whichever comes first. */
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
    setTimeout(measure, 50);
}

/**
 * Renders the status tracker UI box for a message.
 * Called AFTER character image injection.
 * @param {Element} mesEl
 */
export function renderStatusTrackerBox(mesEl) {
    if (!mesEl.hasAttribute('mesid') || mesEl.closest('#welcome-message')) return;

    // Before the removal below, or the guard would take the box away and then decline to
    // put it back. Whatever wanted this redraw can have it when the edit is committed.
    if (isEditingInside(mesEl)) return;

    mesEl.querySelectorAll('.sillynpc-status-tracker-container').forEach(el => el.remove());

    const settings = getSettings().statusTracker;
    if (!settings.enabled) return;

    // The eye, in its third state. Before the review panel below on purpose: a change
    // waiting for a decision is not part of the tracker box and stays reachable either
    // way, which is the same reason that panel sits outside the early returns.
    const view = getTrackerView();

    const messageId = mesEl.getAttribute('mesid');

    // Before any of the early returns below. The status box is often hidden on this
    // message - "show only at the bottom" is the common case - but a change waiting for
    // a decision has to stay reachable under the message that proposed it, or it can
    // only be resolved by scrolling back to a panel that is no longer drawn.
    renderReviewPanel(mesEl, messageId);
    renderExtractionReport(mesEl, messageId);

    if (view === 'hidden') return;

    const context = getContext();
    const chat = (context && Array.isArray(context.chat)) ? context.chat : [];

    if (settings.showOnlyAtBottom) {
        const isLastMessage = chat.length > 0 ? Number(messageId) >= chat.length - 1 : true;
        if (!isLastMessage) return;
    }

    const textContainer = mesEl.querySelector('.mes_text');
    if (!textContainer) return;

    injectCustomCSS(settings.customCSS);

    // Under an older message, show what the tracker held *then*. Drawing the current
    // state under every message is what made "show under all messages" useless: a
    // message from two hundred turns ago claimed the HP the character has today.
    const past = settings.showOnlyAtBottom
        ? { state: loadStateFromMetadata(), exact: true, reason: 'latest' }
        : stateAtMessage(messageId);
    const container = buildTrackerBox(past.state, {
        mesEl,
        view,
        // Only mark it when it genuinely differs from live; an exact reconstruction of the
        // latest message is just the current state.
        reconstructed: past.reason !== 'latest',
        exact: past.exact,
    });
    if (!container) return;

    if (settings.renderPosition === 'top') {
        textContainer.prepend(container);
    } else {
        textContainer.appendChild(container);
    }
}

/**
 * The tracker box for a state: its buttons, its contents and its editing, ready to insert.
 *
 * Split out of renderStatusTrackerBox because the chat is not the only thing that shows
 * this box. The visual novel stage drew only buildStatusHtml - the contents - so the Undo,
 * cast, Add character and Settings buttons, and the listeners that make a value editable,
 * existed in the chat and nowhere on the stage. One builder means one box.
 *
 * @param {object} state The tracker state to draw.
 * @param {object} [options]
 * @param {Element|null} [options.mesEl] The message it belongs to. Add character and the
 *     cast panel redraw that message's box when they are done.
 * @param {'full'|'globals'} [options.view] The eye's state.
 * @param {boolean} [options.reconstructed] Drawn from an older message's state.
 * @param {boolean} [options.exact] Whether that reconstruction is exact.
 * @param {() => void} [options.onRedraw] Also called after the cast panel or Add character
 *     changes the scene, for a box that lives somewhere other than a message.
 * @returns {HTMLElement|null} Null when there is nothing worth drawing.
 */
export function buildTrackerBox(state, {
    mesEl = null, view = getTrackerView(), reconstructed = false, exact = true, onRedraw = null,
} = {}) {
    const settings = getSettings().statusTracker;
    const htmlToRender = buildStatusHtml(state,
        view === 'globals' ? { ...settings, showCharacters: false } : settings);

    if (!hasVisibleContent(htmlToRender)) return null;

    const theme = getSettings().menuStyle || 'default';
    const container = document.createElement('div');
    container.className = `sillynpc-status-tracker-container`;
    container.classList.add(`sillynpc-theme-${theme}`);
    
    const box = document.createElement('div');
    box.className = `sillynpc-status-box sillynpc-theme-${theme}`;

    applyTrackerScale(box);
    
    // Add header buttons inside the box
    const headerBtns = document.createElement('div');
    headerBtns.className = 'sillynpc-status-buttons-container';

    // Undo is only offered when there is something to undo, so the button does not
    // sit there inert on a fresh chat.
    const historyDepth = getHistoryEntries().length;
    if (historyDepth > 0) {
        const undoBtn = document.createElement('div');
        undoBtn.className = 'sillynpc-status-undo-btn fa-solid fa-arrow-left';
        const nextLabel = getHistoryEntries().at(-1)?.label || 'change';
        undoBtn.title = `Undo last change (${nextLabel}) - ${historyDepth} step${historyDepth === 1 ? '' : 's'} available`;
        makeActivatable(undoBtn);
    undoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const entry = undoLastChange();
            if (entry) {
                toastr.info(`Reverted: ${entry.label}`, 'SillyNPC');
            } else {
                toastr.warning('Nothing left to undo.', 'SillyNPC');
            }
        });
        headerBtns.appendChild(undoBtn);
    }

    // Beside the control that adds somebody, because it answers the opposite question.
    const castBtn = document.createElement('div');
    castBtn.className = 'sillynpc-status-cast-btn fa-solid fa-user-check';
    castBtn.title = 'Say who is not a character - the narrator\'s asides, or you';
    makeActivatable(castBtn);
    castBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openCastPanel(() => { if (mesEl) renderStatusTrackerBox(mesEl); onRedraw?.(); });
    });
    headerBtns.appendChild(castBtn);

    const addCharBtn = document.createElement('div');
    addCharBtn.className = 'sillynpc-status-add-btn fa-solid fa-plus';
    addCharBtn.title = 'Add Character to Scene';
    makeActivatable(addCharBtn);
    addCharBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showAddCharacterDropdown(addCharBtn, mesEl, onRedraw, renderStatusTrackerBox);
    });

    const settingsBtn = document.createElement('div');
    settingsBtn.className = 'sillynpc-status-settings-btn fa-solid fa-gear';
    settingsBtn.title = 'Open Status Tracker Settings';
    makeActivatable(settingsBtn);
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        eventSource.emit('sillynpc-open-manage', { tab: 'status' });
    });

    headerBtns.appendChild(addCharBtn);
    headerBtns.appendChild(settingsBtn);
    box.appendChild(headerBtns);
    
    // Parse the HTML to nodes to safely append without destroying the button
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlToRender;
    while(tempDiv.firstChild) {
        box.appendChild(tempDiv.firstChild);
    }
    
    if (reconstructed) {
        container.classList.add('sillynpc-status-historical');
        container.title = exact
            ? 'The tracker as it stood at this message.'
            : 'Approximate: no record exists for the messages after this one.';
        if (!exact) container.classList.add('sillynpc-status-approximate');
    }

    container.appendChild(box);
    
    attachInlineEditListeners(container, { state, mesEl, onRedraw, redrawMessage: renderStatusTrackerBox });
    fitCharacterColumns(box);
    return container;
}
function injectCustomCSS(css) {
    if (!css) return;
    let styleEl = document.getElementById('sillynpc-status-custom-css');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'sillynpc-status-custom-css';
        document.head.appendChild(styleEl);
    }
    if (styleEl.textContent !== css) {
        styleEl.textContent = css;
    }
}
