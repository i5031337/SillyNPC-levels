import { getSettings, saveSettings } from '../../core/settings.js';
import { triggerReprocess } from '../../chat/chat.js';
import { updateHUD } from '../hud/ui-hud.js';
import { renderTrackerDisplayAndReading } from './ui-tracker-display-reading.js';
import { renderTrackerScanAndReview } from './ui-tracker-scan-review.js';
import { renderTrackerCastAndRecovery } from './ui-tracker-cast-recovery.js';

/**
 * The Tracker settings tab, and the two popups it opens.
 *
 * Split out of status-settings.js, which rendered this tab, the HUD tab, System Builder
 * and System Manager from one 2283-line file.
 */

/**
 * Renders the status tracker settings view.
 *
 * Two callbacks, deliberately. Only a handful of controls decide whether *other*
 * controls exist, and only those need the panel rebuilt; everything else saves and lets
 * the chat catch up in place. Rebuilding on every change is what lost your scroll
 * position on each click and made dragging a slider impossible.
 *
 * @param {HTMLElement} container
 */
export function renderStatusView(container) {
    if (!container) return;
    container.replaceChildren();

    const settings = getSettings().statusTracker;

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'Display';
    container.appendChild(title);

    /** Rebuilds the panel. Only for controls that add or remove other controls. */
    const onChange = () => {
        const scrollParent = container.closest('.sillynpc-tab-panel') || container.closest('.popup-body') || container;
        const top = scrollParent.scrollTop;
        renderStatusView(container);
        requestAnimationFrame(() => {
            if (scrollParent) scrollParent.scrollTop = top;
        });
        triggerReprocess();
        updateHUD();
    };

    /** Saves and refreshes the chat, leaving the panel alone. Used by almost everything. */
    const onApply = () => {
        saveSettings();
        triggerReprocess();
        updateHUD();
    };

    const section = (name) => {
        const h = document.createElement('h3');
        h.className = 'sillynpc-section-title';
        h.style.marginTop = '20px';
        h.textContent = name;
        container.appendChild(h);
    };

    const view = { container, settings, onApply, onChange, section };
    renderTrackerDisplayAndReading(view);
    renderTrackerScanAndReview(view);
    renderTrackerCastAndRecovery(view);

}
