import { eventSource } from '../../../../../../events.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { openPlayerSheet } from '../characters/ui-player-sheet.js';
import { trapInlineDisplay, shortenStack } from '../shared/css-origin.js';
import { makeActivatable } from '../../core/utils.js';
import { ensurePortraitImage } from './ui-hud-portrait.js';
import { renderHUD } from './ui-hud-render.js';
export { portraitSizeFor, ringOverhang, ringRadius } from './ui-hud-meters.js';

let hudContainer = null;
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

/** Keep at least this much of the HUD on screen so it can never be dragged out of reach. */
const HUD_VIEWPORT_MARGIN = 48;

/**
 * The corner classes, which are the ones that have to be cleared before another is set.
 *
 * Named rather than cleared wholesale. Three separate functions put classes on this
 * element - the corner and theme here, the portrait's shape and side in
 * applyHudAppearance, the meter style in applyHudProportions - and for a long time this
 * one assigned `className` outright, so it silently deleted the other two's work every
 * time the HUD updated. That is why choosing a portrait side or shape appeared to do
 * nothing at all unless the meter style happened to be re-applied afterwards.
 */
const HUD_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/** How far the pointer must travel before a press on the portrait counts as a drag. */
const DRAG_THRESHOLD = 5;

/**
 * Whether a press has become a drag.
 *
 * The mini-portrait is both the drag handle and the button that opens the player sheet,
 * so a hand that moves slightly while clicking has to still be clicking.
 *
 * @param {number} dx
 * @param {number} dy
 * @returns {boolean}
 */
export function passedDragThreshold(dx, dy) {
    return Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD;
}

/**
 * Keeps a position inside the viewport, given the size actually on screen.
 *
 * Split from the DOM so the arithmetic can be checked on its own. The awkward case is a
 * HUD bigger than the window - at a large scale on a small screen - which has to start at
 * 0 rather than at a negative offset that would push its top-left off the edge.
 *
 * @param {number} x
 * @param {number} y
 * @param {{width: number, height: number}} box The box as seen, zoom included.
 * @param {{width: number, height: number}} viewport
 * @returns {{x: number, y: number}}
 */
export function clampHudPosition(x, y, box, viewport) {
    const maxX = Math.max(0, viewport.width - box.width);
    const maxY = Math.max(0, viewport.height - box.height);
    return {
        x: Math.min(Math.max(0, x), maxX),
        y: Math.min(Math.max(0, y), maxY),
    };
}

/**
 * Clamps a position so the HUD stays on screen.
 *
 * Measured from the rendered box rather than a flat margin, because the box is scaled:
 * getBoundingClientRect already accounts for the zoom, so this is the size the user
 * actually sees.
 *
 * @returns {{x: number, y: number}}
 */
function clampToViewport(x, y) {
    const rect = hudContainer?.getBoundingClientRect();
    return clampHudPosition(
        x, y,
        {
            width: rect?.width || HUD_VIEWPORT_MARGIN,
            height: rect?.height || HUD_VIEWPORT_MARGIN,
        },
        { width: window.innerWidth, height: window.innerHeight },
    );
}

/** HUD Scale, as the zoom it is applied with. */
function hudZoom() {
    const zoom = Number(getSettings().statusTracker.hudScale);
    return zoom > 0 ? zoom : 1;
}

/**
 * Applies HUD Scale as zoom rather than transform: scale().
 *
 * A transform draws the HUD at its normal size and then stretches the result, which is
 * what made the portrait soft however good the picture was - you compared the two ways
 * side by side on your own screen and the stretched one was the blurry one. Zoom lays the
 * HUD out at the larger size, so it is drawn sharp at the size you see.
 *
 * Zoom also scales the element's own left, top, right and bottom, and a translate. So
 * positions are written divided by it (placeHud), and the corner offsets in the stylesheet
 * divide by --sillynpc-hud-zoom.
 */
function applyHudZoom() {
    const zoom = hudZoom();
    hudContainer.style.transform = '';
    hudContainer.style.transformOrigin = '';
    hudContainer.style.zoom = String(zoom);
    hudContainer.style.setProperty('--sillynpc-hud-zoom', String(zoom));
}

/** Puts the HUD's top-left corner at x, y in screen pixels. See applyHudZoom. */
function placeHud(x, y) {
    const zoom = hudZoom();
    hudContainer.style.left = `${x / zoom}px`;
    hudContainer.style.top = `${y / zoom}px`;
}

/** Re-clamps a dragged HUD after the window changes size. */
function keepHudOnScreen() {
    const settings = getSettings().statusTracker;
    const pos = settings.hud?.position;
    // A corner-anchored HUD is positioned by CSS and needs no help; only a dragged one
    // can end up outside a window that has since been made smaller.
    if (!hudContainer || pos?.x === null || pos?.x === undefined || pos?.y === null || pos?.y === undefined) return;
    const { x, y } = clampToViewport(pos.x, pos.y);
    settings.hud.position.x = x;
    settings.hud.position.y = y;
    placeHud(x, y);
    saveSettings();
}

export function initHUD() {
    if (hudContainer) return;

    const settings = getSettings().statusTracker;
    const parent = document.body;

    hudContainer = document.getElementById('sillynpc-hud');
    if (!hudContainer) {
        hudContainer = document.createElement('div');
        hudContainer.id = 'sillynpc-hud';
        parent.append(hudContainer);
        window.addEventListener('resize', keepHudOnScreen);
    }
    
    hudContainer.classList.add('sillynpc-hud-container');
    hudContainer.classList.remove(...HUD_CORNERS);
    hudContainer.classList.add(settings.hudPosition);
    hudContainer.style.position = 'fixed';
    // z-index comes from --sillynpc-z-hud so the HUD sits above the chat but below
    // SillyTavern's own panels, drawers and menus. An inline 10000 here used to beat
    // them all and cover whatever the user had just opened.
    applyHudZoom();

    // Restore position
    if (settings.hud?.position?.x !== null && settings.hud?.position?.y !== null) {
        const { x, y } = clampToViewport(settings.hud.position.x, settings.hud.position.y);
        placeHud(x, y);
        hudContainer.style.right = 'auto';
        hudContainer.style.bottom = 'auto';
    }
    
    hudContainer.innerHTML = '';
    
    // Drag handle / Mini-portrait
    const portrait = document.createElement('div');
    portrait.className = 'sillynpc-hud-portrait';

    /* The face is an <img> inside the frame rather than the frame's background-image.
       Every other portrait in the extension - the chat avatars, the character cards, the
       tracker rows - is an <img>, and those are the ones that looked right; this was the
       only background-image and the only one that came out coarse at any HUD scale.

       Inside rather than instead of: the div carries the drag handle, the click that opens
       the sheet, the keyboard activation, and the plate layout's corner marks, which are
       positioned outside its edges. Clipping the picture with overflow on the frame would
       cut those off, so the picture rounds itself with border-radius: inherit and the
       frame keeps its overflow. */
    ensurePortraitImage(portrait);
    /* Watch for whoever sets display on it. The picture ends up with an inline
       `display: none` that no stylesheet accounts for, and neither this extension nor
       SillyTavern nor the installed theme has a line that obviously would - so the
       assignment is caught where it happens and the caller written down. Recording only;
       the value still lands. See trapInlineDisplay. */
    const trapped = portrait.querySelector('.sillynpc-hud-portrait-img');
    if (trapped) {
        trapInlineDisplay(trapped, (value, stack) => {
            if (value !== 'none') return;
            const by = shortenStack(stack);
            portrait.dataset.faceHiddenBy = by;
            /* And onto the visible attribute straight away, rather than waiting for the
               next draw to fold it in. Every draw rebuilds the frame, so a hide arriving
               after updateHUD has finished would be recorded on an element that is thrown
               away before anything reads it - the reason recorded and never shown. */
            portrait.dataset.faceWhy = `inline:none << ${by}`;
        });
    }
    portrait.addEventListener('mousedown', startDrag);
    makeActivatable(portrait, { label: 'Open your character sheet' });
    portrait.addEventListener('click', (e) => {
        if (!isDragging) openPlayerSheet();
    });
    
    const statsContainer = document.createElement('div');
    statsContainer.className = 'sillynpc-hud-stats';
    
    hudContainer.append(portrait, statsContainer);
    
    updateHUD();

    eventSource.on('sillynpc-status-updated', (state) => updateHUD(state));
}

/**
 * Drops any manually dragged position so the HUD snaps back to its configured corner.
 */
export function resetHudPosition() {
    const st = getSettings().statusTracker;
    if (!st.hud) st.hud = { position: { x: null, y: null } };
    st.hud.position.x = null;
    st.hud.position.y = null;
    saveSettings();
    if (hudContainer) {
        hudContainer.style.removeProperty('left');
        hudContainer.style.removeProperty('top');
        hudContainer.style.removeProperty('right');
        hudContainer.style.removeProperty('bottom');
        hudContainer.style.removeProperty('margin');
    }
    updateHUD();
}

export function forgetPortrait() {
    const face = hudContainer?.querySelector('.sillynpc-hud-portrait-img');
    if (face) face.dataset.sillynpcSource = '';
}

export function updateHUD(updatedState = null) {
    renderHUD(hudContainer, updatedState, { isDragging, applyHudZoom, clampToViewport, placeHud });
}

function pinHudAt(rect) {
    placeHud(rect.left, rect.top);
    hudContainer.style.right = 'auto';
    hudContainer.style.bottom = 'auto';
    hudContainer.style.margin = '0';
    hudContainer.classList.remove('top-left', 'top-right', 'bottom-left', 'bottom-right');
}

function startDrag(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging = false;
    const startX = e.clientX;
    const startY = e.clientY;

    const rect = hudContainer?.getBoundingClientRect();
    if (!rect) return;
    // Against the visible box, which is what pinHudAt makes left/top mean.
    dragOffset.x = startX - rect.left;
    dragOffset.y = startY - rect.top;

    /* Moved with `translate` on every move, and put down with left/top only on release.
     *
     * It used to write left/top on every mouse move. That is a layout per move, and the HUD
     * has a blurred see-through background, so each one also re-blurred everything behind
     * it - a video background included. Dragging lagged, and on a weaker machine it could
     * stall. translate is moved by the compositor without layout, and the blur is switched
     * off for the length of the drag (is-dragging), so a move costs almost nothing. */
    let offsetX = 0;
    let offsetY = 0;
    const zoom = hudZoom();

    const onMouseMove = (moveEvent) => {
        if (!isDragging) {
            if (!passedDragThreshold(moveEvent.clientX - startX, moveEvent.clientY - startY)) return;
            isDragging = true;
            // Only once it is really a drag. A press that turns out to be a click has to
            // leave the HUD anchored to its corner: pinning it on mousedown would strand
            // it at inline coordinates that the corner setting can no longer override.
            pinHudAt(rect);
            hudContainer.classList.add('is-dragging');
        }

        offsetX = moveEvent.clientX - startX;
        offsetY = moveEvent.clientY - startY;
        // Straight away, on every move - not saved up for the next frame. Of the three ways
        // you tried, this is the one that felt like a window. Divided by the zoom, which
        // scales a translate too.
        hudContainer.style.translate = `${offsetX / zoom}px ${offsetY / zoom}px`;
    };

    const onMouseUp = (upEvent) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (!isDragging) return;

        const settings = getSettings().statusTracker;
        if (!settings.hud) settings.hud = { position: { x: null, y: null } };

        // Where it was let go, from the pointer - not measured, and with the translate gone.
        const dropX = (upEvent?.clientX ?? startX + offsetX) - dragOffset.x;
        const dropY = (upEvent?.clientY ?? startY + offsetY) - dragOffset.y;
        hudContainer.style.translate = '';
        hudContainer.classList.remove('is-dragging');
        // The origin is top-left by now, so the visible box and left/top are the same
        // coordinates and the clamp can compare them without converting anything.
        const { x, y } = clampToViewport(dropX, dropY);
        settings.hud.position.x = x;
        settings.hud.position.y = y;
        placeHud(x, y);
        saveSettings();
        // The click handler runs after mouseup, and has to see that this was a drag.
        setTimeout(() => { isDragging = false; }, 50);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}
