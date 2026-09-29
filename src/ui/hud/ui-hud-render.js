import { eventSource } from '../../../../../../events.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { loadStateFromMetadata, findMatchingStatKey, getPersonaData, getPlayerImageUrl, resolveMaxValue, drawsMeter, hasOpenChat } from '../../tracker/status-logic.js';
import {
    allThemeClasses, themeClassFor, BUILT_IN_DEFAULT_AVATAR,
    hudLayoutFor, allHudLayoutClasses,
} from '../../core/constants.js';
import { computeStatBar, splitValue, applyStatFormat, portraitRendition } from '../../core/utils.js';
import { whyHidden, trapInlineDisplay, shortenStack } from '../shared/css-origin.js';
import { makeActivatable } from '../../core/utils.js';
import { ensurePortraitImage, recordFaceState } from './ui-hud-portrait.js';
import { portraitSizeFor, showPortraitAtSize, applyHudProportions, buildMeterRow, paintSplitRing, applyHudAppearance } from './ui-hud-meters.js';

const HUD_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export function renderHUD(hudContainer, updatedState, { isDragging, applyHudZoom, clampToViewport, placeHud }) {
    if (!hudContainer) return;
    
    const allSettings = getSettings();
    const settings = allSettings.statusTracker;
    // A player sheet with no chat behind it is showing whatever the last chat left in
    // memory, which reads as the current state and is not.
    if (!settings.hudEnabled || !hasOpenChat()) {
        hudContainer.style.display = 'none';
        return;
    }
    hudContainer.style.display = 'flex';
    
    const theme = allSettings.menuStyle || 'default';
    const themeClass = themeClassFor(theme);
    hudContainer.classList.remove(...allThemeClasses());

    // A settings block with no hud in it leaves both undefined, and `undefined !== null`
    // is true - which read as "the user dragged it here" and placed the HUD at NaN.
    const hasManualPos = Number.isFinite(settings.hud?.position?.x)
        && Number.isFinite(settings.hud?.position?.y);
    applyHudAppearance(hudContainer, settings);

    // Not while it is being dragged. A status update landing mid-drag would otherwise
    // restore the corner class and origin under the cursor, snapping the HUD away from
    // the hand holding it.
    if (!isDragging) {
        // The corner and the theme only. Assigning className here wiped the portrait's
        // shape and side, which applyHudAppearance had set eight lines earlier - see
        // HUD_CORNERS. The theme classes were already removed above.
        hudContainer.classList.remove(...HUD_CORNERS);
        if (!hasManualPos) hudContainer.classList.add(settings.hudPosition);
        hudContainer.classList.add(themeClass);
        applyHudZoom();

        if (hasManualPos) {
            const { x, y } = clampToViewport(settings.hud.position.x, settings.hud.position.y);
            placeHud(x, y);
            hudContainer.style.right = 'auto';
            hudContainer.style.bottom = 'auto';
        } else {
            // The corner classes place it, and an inline left/top left over from a drag
            // that was undone would silently beat them - so Reset HUD Position would
            // appear to do nothing until the page was reloaded.
            for (const side of ['left', 'top', 'right', 'bottom', 'margin']) {
                hudContainer.style.removeProperty(side);
            }
        }
    }

    const state = updatedState || loadStateFromMetadata();
    if (!state || !state.player || !state.player.stats) {
        // Hidden rather than left standing. Everything above has already made the HUD
        // visible, so returning here used to leave the previous chat's numbers on screen
        // looking like the current ones - the failure state was indistinguishable from
        // working, which is the worst way for it to fail.
        console.warn('SillyNPC: HUD update skipped - state or player data missing', state);
        hudContainer.style.display = 'none';
        return;
    }
      const persona = getPersonaData();
    
    const portrait = hudContainer.querySelector('.sillynpc-hud-portrait');
    
    /* The full avatar rather than SillyTavern's 96x144 thumbnail: the portrait scales with
       the meter count and can be square, so the thumbnail was being upscaled and looked
       soft. It is one image on screen, not a gallery.

       The player's own portrait first, so the HUD and the sheet show one face. The persona
       picture is what is left when they have not made one. */
    const src = getPlayerImageUrl() || persona.avatarUrl || persona.avatarThumbUrl
        || BUILT_IN_DEFAULT_AVATAR;
    // Compared before assigning: updateHUD runs on every status change, and re-setting an
    // identical src makes the picture flicker while the browser re-fetches it.
    const face = ensurePortraitImage(portrait);
    /* --- why the attribute has this ungainly name ---
     *
     * It was `data-source`, and that is what made the picture disappear whenever the
     * SillyTavern preset changed. `setupChatCompletionPromptManager` ends with
     * (scripts/openai.js:6034):
     *
     *     $('[data-source]').each(function () { ... $(this).toggle(matchesSource); });
     *
     * A document-wide selector. Every element anywhere on the page carrying a
     * `data-source` attribute is hidden unless its comma-separated list names the
     * current chat-completion source - and a file path names no source at all, so the
     * portrait was hidden by a control panel it has nothing to do with.
     *
     * It took six rounds to find because it is invisible from inside this extension:
     * nothing here hides the picture, no stylesheet accounts for it, and every diagnosis
     * that started from our own code was looking in the wrong repository. The answer
     * came from trapping the inline write and reading the caller off its stack.
     *
     * So: **any data attribute this extension puts on an element in the live document is
     * a name shared with SillyTavern and every other extension.** Namespaced from here
     * on, and a check asserts it. */
    /* Also when the picture on screen is broken, not only when the source has changed.
     *
     * The comparison alone has no way back. Whatever leaves the element unable to draw -
     * a rendition that came out unusable, a file that went away, a reload of settings
     * under it - `dataset.sillynpcSource` still matches, so the src is never written again and
     * the portrait stays blank until the whole HUD is rebuilt by a page refresh. Which is
     * exactly how it was reported: gone after changing preset, back after F5.
     *
     * naturalWidth is zero only for an image that has finished trying and failed; a
     * picture still loading has complete false and is left alone. */
    const broken = face?.complete && face.naturalWidth === 0;
    if (face && (face.dataset.sillynpcSource !== src || broken)) {
        face.dataset.sillynpcSource = src;
        face.src = src;
    }
    recordFaceState(portrait, face, src);
    // Measured after applyHudProportions below, not here: the portrait's size is set by
    // that call, so measuring now reads whatever the *previous* render left behind - or,
    // on the first draw of a session, the stylesheet's default. Either way the rendition
    // is chosen for the wrong size, and choosing one too small is precisely the blur this
    // was built to remove.

    // Update Stats
    const statsContainer = hudContainer.querySelector('.sillynpc-hud-stats');
    statsContainer.innerHTML = '';

    const layout = hudLayoutFor(settings.hudLayout);
    const style = layout.meters;
    // HUD is its own flag now. It used to read visible as well, which is the flag that
    // says whether a stat belongs on the in-chat tracker - a different place entirely.
    const primaryStats = settings.playerStats.filter(s => s.isPrimary);

    const meters = primaryStats.map(statDef => {
        const actualKey = findMatchingStatKey(state.player.stats, statDef.name) || statDef.name;
        const rawValue = state.player.stats[actualKey] || statDef.defaultValue || '0';

        // Shared with the in-chat tracker. Handles "8/10", bare numbers, decimals and
        // negatives - the previous digit-only match read "-40" as +40, which breaks any
        // stat with a signed range such as an affinity of -100..100.
        const bar = computeStatBar({
            rawValue,
            min: statDef.min,
        });
        /* drawsMeter, not a rule of the HUD's own. This asked only whether the value had a
           ceiling and never what kind of field it was, so a field switched back to Text kept
           its meter here for as long as its value had a slash - while the tracker box, which
           asked the type and not the value, disagreed in the other direction. */
        return {
            statDef,
            rawValue,
            bar: { ...bar, numeric: bar.numeric && drawsMeter(statDef, rawValue) },
        };
    });


    if (style === 'ring') {
        // The portrait size for this frame is decided below, so compute it here too
        // rather than reading a variable that has not been written yet.
        //
        // Six, where the old concentric rings managed three: segments share one
        // circumference, so a fourth stat makes them shorter rather than pushing another
        // ring outward and the panel wider with it. Past six they are too short to read.
        const ringed = meters.filter(m => m.bar.numeric).slice(0, 6);
        paintSplitRing(portrait, ringed, {
            square: settings.hudPortraitShape === 'square',
            size: portraitSizeFor(0, 'ring'),
            thickness: Number(settings.hudRingThickness) || 5,
        });
        // Anything a ring cannot show still has to be readable, so a stat with no ceiling
        // and any meter past the sixth falls back to a row rather than being dropped.
        const shown = new Set(ringed);
        meters.filter(m => !shown.has(m))
            .forEach(m => statsContainer.append(buildMeterRow(m.statDef, m.rawValue, m.bar, 'bar')));
    } else {
        portrait.querySelectorAll('.sillynpc-hud-rings').forEach(el => el.remove());
        meters.forEach(m => statsContainer.append(buildMeterRow(m.statDef, m.rawValue, m.bar, style)));
    }

    applyHudProportions(hudContainer, meters.length, layout);

    /* Now the portrait is the size it is going to be, so it can be measured.
     *
     * This used to run beside the src assignment, three hundred lines up and before the
     * size was applied. The rendition was therefore picked for the frame's previous size,
     * which is right only when nothing has changed - and wrong on the first draw, after a
     * layout change, and whenever the number of meters moves the frame. */
    if (face) showPortraitAtSize(face, src);
}

/**
 * Keeps the portrait and the meter column the same height.
 *
 * The portrait was a fixed 60px while the column grew with the number of meters, so the
 * two only lined up by coincidence - at two meters the column was about 36px and the HUD
 * looked lopsided. Sizing the portrait from the row count keeps it square with whatever
 * is beside it, however many meters there are.
 *
 * @param {HTMLElement} container
 * @param {number} meterCount
 * @param {string} style
 */
/**
 * The portrait's pixel size for a given meter count and style.
 *
 * Shared, because the ring painter needs the same answer applyHudProportions writes to the
 * stylesheet: the rings are drawn around the portrait, so a disagreement puts them in the
 * wrong place rather than merely looking odd.
 *
 * @param {number} meterCount
 * @param {string} style
 * @returns {number}
 */
