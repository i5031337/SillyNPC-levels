import { getSettings } from '../../core/settings.js';
import { updateHUD } from '../hud/ui-hud.js';
import { loadStateFromMetadata, findMatchingStatKey } from '../../tracker/status-logic.js';
import { computeStatBar } from '../../core/utils.js';
import { allThemeClasses, themeClassFor, SILLYNPC_THEMES } from '../../core/constants.js';

const PORTRAIT_FRAMINGS = ['top', 'center', 'bottom'];

/**
 * Publishes the chosen portrait framing for the stylesheet to read.
 *
 * One write on the document element, rather than a rule per portrait: the HUD circle and
 * the tracker box's NPC portraits both read `--sillynpc-portrait-focus`, and anything round
 * added later gets it for free.
 *
 * An unrecognised stored value becomes `top` rather than reaching the stylesheet, where an
 * invalid position is silently dropped and the portrait quietly reverts to whatever the
 * browser defaults to.
 *
 * @returns {string} The framing actually applied.
 */
/**
 * Writes the speech-block padding to the document root.
 *
 * A root variable rather than a class, because two rules read it - the plain block and the
 * coloured-background variant - and they have to move together.
 *
 * @returns {number} The applied value, after clamping.
 */
export function applySpeechPadding() {
    const raw = Number(getSettings().speechPadY);
    // Clamped rather than trusted: a negative padding is valid CSS and pulls neighbouring
    // blocks into each other, which looks like a rendering fault rather than a setting.
    const padding = Number.isFinite(raw) ? Math.max(0, Math.min(40, Math.round(raw))) : 6;
    document.documentElement?.style?.setProperty('--sillynpc-speech-pad-y', `${padding}px`);
    return padding;
}

export function applyPortraitFraming() {
    const stored = String(getSettings().portraitFraming ?? '').trim().toLowerCase();
    const framing = PORTRAIT_FRAMINGS.includes(stored) ? stored : 'top';
    document.documentElement?.style?.setProperty('--sillynpc-portrait-focus', framing);
    return framing;
}

/**
 * Updates the extension theme classes on all open extension windows.
 */
export function updateAllExtensionThemes() {
    // Target all active SillyNPC containers in the DOM
    const manageContainers = document.querySelectorAll('.sillynpc-manage, .sillynpc-player-sheet');
    manageContainers.forEach(container => {
        updateExtensionTheme(container);
    });

        // Target all status boxes in the chat
        const statusContainers = document.querySelectorAll('.sillynpc-status-tracker-container');
        statusContainers.forEach(container => {
            const box = container.querySelector('.sillynpc-status-box') || container;
            updateExtensionTheme(box);
            
            // Fix: Re-calculate progress bar widths if they exist in this box
            const state = loadStateFromMetadata();
            const playerStats = getSettings().statusTracker.playerStats;
            
            container.querySelectorAll('.sillynpc-hud-bar').forEach(bar => {
                const statClass = Array.from(bar.classList).find(c => c !== 'sillynpc-hud-bar');
                if (statClass) {
                    const statDef = playerStats.find(s => s.name.toLowerCase().replace(/\s+/g, '-') === statClass);
                    if (statDef && state.player && state.player.stats) {
                        const actualKey = findMatchingStatKey(state.player.stats, statDef.name) || statDef.name;
                        const rawValue = state.player.stats[actualKey] || statDef.defaultValue || '0';
                        // No configured max: the value's own ceiling, the same reading the
                        // HUD makes when it builds the bar. A disagreement here shows as the
                        // bar jumping to a different width on the next refresh.
                        const { percent } = computeStatBar({
                            rawValue,
                            min: statDef.min,
                        });
                        bar.style.width = `${percent}%`;
                    }
                }
            });
        });

    // Update the HUD
    updateHUD();
}

/**
 * Updates the extension theme classes on the given root and its parent popup.
 * @param {HTMLElement} root The root element of the extension UI
 * @param {Popup} [popupInstance] Optional popup instance to target
 */
export function updateExtensionTheme(root, popupInstance = null) {
    if (!root) return;
    const style = getSettings().menuStyle || 'default';
    const container = root.classList.contains('sillynpc-manage') || root.classList.contains('sillynpc-player-sheet') ? root : root.querySelector('.sillynpc-manage') || root.querySelector('.sillynpc-player-sheet');
    if (!container) return;
    
    const themeClasses = allThemeClasses();
    container.classList.remove(...themeClasses);

    const isSillyNPCTheme = SILLYNPC_THEMES.includes(style);
    const themeClass = themeClassFor(style);
    
    // Fallback: if it's a SillyTavern native theme not in our special list, still try to add it
    // so CSS variables from that theme can be used.
    container.classList.add(themeClass);
    if (!isSillyNPCTheme && style !== 'default') {
        container.classList.add(`sillynpc-theme-${style}`);
    }

    // Text size, as a multiplier of whatever the theme sets rather than a size of its own,
    // so a theme that ships larger type stays proportionally itself. Set here because this
    // is the one function every menu and sheet goes through to be themed.
    const menuScale = Number(getSettings().menuFontScale);
    container.style.setProperty('--sillynpc-font-scale',
        String(Number.isFinite(menuScale) && menuScale > 0 ? menuScale : 1));
    
    // Target the actual SillyTavern Popup dialog element
    const dlg = popupInstance?.dlg || container.closest('.popup, #dialogue_popup');
    if (dlg) {
        dlg.classList.remove(...themeClasses);
        dlg.classList.add(themeClass);
        // Force theme inheritance on the popup dialog wrapper
        dlg.style.setProperty('color', 'var(--sillynpc-fg-primary)', 'important');
        dlg.style.setProperty('font-family', 'var(--sillynpc-font-family)', 'important');
    }
}

/**
 * Repositions SillyTavern's default close button inside our visual container.
 * Solves the issue where the "X" button floats far away on customized layouts.
 *
 * It **moves the node**, rather than styling it where it sits. So `visualContent` must be
 * an element the panel never replaces the children of: the Entry Library handed in its own
 * scrolling root and redrew it on every delete, keystroke and rename, which destroyed the
 * only visible way out of the popup. Give this a wrapper and redraw a child of it.
 *
 * Safe to call again - appendChild on a child already there just moves it - and calling it
 * again is how a button that has been wiped comes back, since popupInstance.closeButton
 * still references the detached node.
 */
export function repositionCloseButton(popupInstance, visualContent) {
    if (!popupInstance || !popupInstance.dlg || !visualContent) return;

    // SillyTavern's close control is '.popup-button-close', and Popup exposes it as
    // .closeButton (popup.js:256). The previous selector list - '.popup_close,
    // #dialogue_popup_close, .close_button' - matched none of them, so this function
    // silently did nothing and the X floated outside the styled panel.
    const closeBtn = popupInstance.closeButton
        || popupInstance.dlg.querySelector('.popup-button-close');
    if (!closeBtn) return;

    visualContent.style.position = 'relative';
    visualContent.appendChild(closeBtn);
    closeBtn.style.cssText = 'position: absolute; top: var(--sillynpc-space-md); '
        + 'right: var(--sillynpc-space-md); cursor: pointer; '
        + 'z-index: var(--sillynpc-z-modal); margin: 0;';
}
