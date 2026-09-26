import { eventSource } from '../../../../events.js';
import { getSettings, saveSettings } from './settings.js';
import { loadStateFromMetadata, findMatchingStatKey, getPersonaData, getPlayerImageUrl, resolveMaxValue, drawsMeter, hasOpenChat } from './status-logic.js';
import { openPlayerModal } from './ui-player-modal.js';
import {
    allThemeClasses, themeClassFor, BUILT_IN_DEFAULT_AVATAR,
    hudLayoutFor, allHudLayoutClasses,
} from './constants.js';
import { computeStatBar, splitValue, applyStatFormat, portraitRendition } from './utils.js';
import { whyHidden, trapInlineDisplay, shortenStack } from './css-origin.js';
import { makeActivatable } from './utils.js';

/**
 * The portrait's <img>, made if it is not there.
 *
 * Called on every draw, not only when the HUD is built. The frame is looked up by class
 * and the picture inside it by another, so anything that leaves the frame without its
 * image - and the reported case is real, even if what does it is not yet known - leaves
 * the HUD permanently faceless: updateHUD finds nothing and does nothing, and only
 * rebuilding the whole widget with a page refresh puts it back.
 *
 * Making it here instead means the invariant is restored by the next draw rather than by
 * the reader.
 *
 * @param {HTMLElement} portrait The frame.
 * @returns {HTMLImageElement|null}
 */
export function ensurePortraitImage(portrait) {
    if (!portrait) return null;
    const existing = portrait.querySelector('.sillynpc-hud-portrait-img');
    if (existing) return existing;

    const face = document.createElement('img');
    face.className = 'sillynpc-hud-portrait-img';
    face.alt = '';
    /* A picture that cannot be drawn falls back rather than staying blank.
     *
     * Deliberately not `img.remove()`, which is what the chat's avatars do: those are one
     * of many and a missing one is a gap, while this is the only portrait the HUD has.
     * First the full picture, in case a downscaled rendition was the problem, and then
     * the built-in face. */
    face.addEventListener('error', () => {
        const full = face.dataset.sillynpcSource;
        if (full && face.getAttribute('src') !== full) face.src = full;
        else if (face.getAttribute('src') !== BUILT_IN_DEFAULT_AVATAR) {
            face.src = BUILT_IN_DEFAULT_AVATAR;
        }
    });
    portrait.prepend(face);
    return face;
}

/**
 * Writes down what state the portrait is actually in.
 *
 * Every way this can fail looks the same from outside - an empty circle - and that is why
 * it has been misdiagnosed repeatedly: a missing element, a src that was never written, a
 * src cleared to nothing, and a picture that loaded perfectly and draws nothing are four
 * different bugs wearing one face. None can be told apart without a console, and a console
 * is not always available to the person seeing it.
 *
 * So the frame carries the answer. No visual effect; two attributes a stylesheet can read
 * out with `content: attr(data-face)`.
 *
 * It also earns its keep beyond any one bug: the frame shows a tint while no picture has
 * loaded, and until now had no way to tell "still fetching" from "gave up".
 *
 * @param {HTMLElement} portrait The frame.
 * @param {HTMLImageElement|null} face
 * @param {string} src What it was last asked to show.
 */
export function recordFaceState(portrait, face, src) {
    if (!portrait) return;

    let state;
    if (!face) state = 'none';
    else if (!face.hasAttribute('src')) state = 'nosrc';
    else if (face.getAttribute('src') === '') state = 'empty';
    else if (!face.complete) state = 'loading';
    else if (face.naturalWidth === 0) state = 'broken';
    else state = `ok:${face.naturalWidth}`;

    portrait.dataset.face = state;
    /* The tail only. It separates a file path from a data: URL, which is the distinction
       that matters, without putting a whole base64 image into an attribute. */
    portrait.dataset.faceTail = String(src ?? '').slice(-40);

    /* And how it is being laid out, because `ok` turned out not to mean visible.
     *
     * The first reading of this diagnostic came back `ok:864` over a circle with nothing
     * in it: the file is fetched, decoded and 864 pixels wide, and still nothing is
     * painted. That eliminates every question about data and loading at once and leaves
     * only how the element is drawn - a box collapsed to nothing, or display, visibility
     * or opacity turned off by something.
     *
     * Reported as one string rather than guessed at a fifth time. The frame's box comes
     * with it: a frame of the right size holding an image of no size is a different bug
     * from both of them being wrong. */
    if (face) {
        const box = face.getBoundingClientRect();
        const frame = portrait.getBoundingClientRect();
        const css = getComputedStyle(face);
        portrait.dataset.faceBox = `${Math.round(box.width)}x${Math.round(box.height)}`
            + ` ${css.display}/${css.visibility}/${css.opacity}`
            + ` frame:${Math.round(frame.width)}x${Math.round(frame.height)}`;

        // Only when it is actually hidden. See whyHidden.
        const invisible = css.display === 'none' || css.visibility === 'hidden'
            || Number(css.opacity) === 0 || box.width === 0 || box.height === 0;
        if (invisible) {
            const by = portrait.dataset.faceHiddenBy;
            portrait.dataset.faceWhy = by ? `${whyHidden(face)} << ${by}` : whyHidden(face);
        }
        else delete portrait.dataset.faceWhy;
    } else {
        portrait.dataset.faceBox = 'no element';
        delete portrait.dataset.faceWhy;
    }
}

/**
 * Throws away what the portrait thinks it is showing, so the next draw rebuilds it.
 *
 * One of the remaining explanations for the picture vanishing on a preset change is a
 * rendition that decoded to something unusable: portraitRendition caches by
 * `source@step`, so once a bad one is in there every later draw is handed the same bad
 * value, and only reloading the page - which drops the module and its cache - brings the
 * picture back. That matches the report exactly, and it is the only one of the candidates
 * with a remedy that does not depend on knowing which candidate it is.
 *
 * Clearing dataset.sillynpcSource makes the next updateHUD assign the full picture again rather
 * than deciding nothing has changed.
 *
 * If the frame's data-face still reads `ok:<width>` after this, the rendition was never
 * the problem and this line is doing nothing. See recordFaceState.
 */
