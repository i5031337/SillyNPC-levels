import { resolveMaxValue } from '../../tracker/status-logic.js';
import { allHudLayoutClasses } from '../../core/constants.js';
import { splitValue, applyStatFormat, portraitRendition } from '../../core/utils.js';

export function portraitSizeFor(meterCount, style) {
    const ROW = 22;   // one meter row plus its gap
    const MIN = 72;
    const MAX = 120;
    // Rings wrap the portrait rather than stacking beside it, so they add no height.
    const rows = style === 'ring' ? 0 : meterCount;
    // The portrait is the thing being looked at and the meters are the caption. It used to
    // measure exactly the height of the column beside it, which made it the smaller half
    // of the HUD at every stat count - so it is deliberately a little taller than the
    // column now, and it starts larger with one stat rather than shrinking to a token.
    return Math.max(MIN, Math.min(MAX, rows * ROW + 26));
}

/**
 * Put a portrait on screen at about the resolution it is actually drawn at.
 *
 * An 864x1184 file in a hundred-pixel circle came out coarse here while the same file in
 * the chat and on the character cards did not, and enlarging it in place showed it was
 * crisp all along - so what went wrong was the reduction, not the picture. This hands the
 * browser one that is already close to the right size.
 *
 * The size is measured, not calculated. getBoundingClientRect reports the box after the
 * HUD's own zoom, so a portrait 72 CSS pixels wide at hudScale 1.7 measures about 122
 * - the scale is already in the number and must not be multiplied in again. Only
 * devicePixelRatio is left to apply, and it is the one a display running at 125% or 150%
 * quietly makes matter.
 *
 * Under-sizing the rendition would be worse than not doing this at all, so renditionStep
 * rounds up and the measurement is taken from the element rather than from the settings.
 *
 * The full picture is shown first and swapped when the rendition is ready, so nothing waits
 * on a canvas; after the first time the cache answers immediately. The guard against a
 * stale swap is the element's own source - by the time this resolves the persona may have
 * changed, and writing the old face over the new one would be a worse bug than the one
 * being fixed.
 *
 * @param {HTMLImageElement} face
 * @param {string} src
 */
export function showPortraitAtSize(face, src) {
    // The frame's larger side: the picture is cropped to cover it (object-fit: cover), so its
    // shorter side must reach across whichever way the frame is longer.
    const frame = face.parentElement?.getBoundingClientRect();
    const across = Math.max(frame?.width || 0, frame?.height || 0);
    const wanted = Math.ceil(across * (window.devicePixelRatio || 1));
    if (!wanted) return;

    portraitRendition(src, wanted).then(ready => {
        if (ready && ready !== face.getAttribute('src') && face.dataset.sillynpcSource === src) {
            face.src = ready;
        }
    }).catch(() => { /* the full picture is already on screen */ });
}

/**
 * The layout's class, the meter geometry, and the portrait's size.
 *
 * The class is removed and re-added by name rather than by clearing the attribute: three
 * functions put classes on this element, and one of them clearing everything is the bug
 * that made the portrait's shape and side settings do nothing for months.
 */
export function applyHudProportions(container, meterCount, layout) {
    container.classList.remove(...allHudLayoutClasses());
    container.classList.add(`sillynpc-hud-${layout.id}`);

    // Rings need room outside the portrait, and no reserved column beside it. Kept as its
    // own class rather than folded into the layout class because the geometry rules -
    // padding against the ring overhang - are about the meter shape, not the frame.
    container.classList.toggle('meter-ring', layout.meters === 'ring');

    const size = portraitSizeFor(meterCount, layout.meters);
    container.style.setProperty('--sillynpc-hud-portrait-size', `${size}px`);
}

/**
 * The colour a primary stat's meter is drawn in.
 *
 * Colours used to live in the stylesheet keyed to the stat's *name* - `.hud-bar.hp` was
 * red, `.hud-bar.energy` blue - so marking any other stat as Primary produced a meter
 * with no background at all. It appeared, drew nothing, and read as "Primary does
 * nothing". The colour belongs to the stat, so it is stored on the stat.
 *
 * @param {object} statDef
 * @returns {string}
 */
function meterColour(statDef) {
    return statDef.color || 'var(--sillynpc-accent-text, var(--sillynpc-accent))';
}

/**
 * Builds one meter row.
 *
 * A value with no number in it - a text stat, or a number with no ceiling - cannot fill
 * anything, and used to render a bar stuck at 0% for the life of the chat. Those fall
 * back to the value alone, which is the only honest way to show them.
 *
 * @param {object} statDef
 * @param {string} rawValue
 * @param {{ percent: number, numeric: boolean }} bar
 * @param {string} style The chosen layout's meter style, or 'underline'.
 * @returns {HTMLElement}
 */
export function buildMeterRow(statDef, rawValue, bar, style) {
    const row = document.createElement('div');
    row.className = 'sillynpc-hud-stat-row';
    row.title = `${statDef.name}: ${rawValue}`;
    // The stat's own colour, on the row, so a layout can reach it from CSS without every
    // piece inside having to be painted individually.
    row.style.setProperty('--sillynpc-hud-stat-colour', meterColour(statDef));

    const label = applyStatFormat(statDef.format, {
        value: rawValue,
        name: statDef.name,
        // The ceiling being shown, not the one this stat started with.
        max: String(splitValue(rawValue).max ?? '') || resolveMaxValue(statDef) || '',
    });

    // Written by every layout and shown by the ones that want it. Underlines is built
    // around the names being readable; the rest hide it in CSS and let the colour say
    // which stat is which.
    const name = document.createElement('div');
    name.className = 'sillynpc-hud-stat-name';
    name.textContent = statDef.name;
    row.append(name);

    if (!bar.numeric) {
        const text = document.createElement('div');
        text.className = 'sillynpc-hud-stat-text';
        text.style.color = meterColour(statDef);
        text.textContent = style === 'underline' ? rawValue : label;
        row.append(text);
        return row;
    }

    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-hud-bar-wrap';

    if (style === 'pips') {
        // Ten notches, filled from the left. Small changes are easier to see than on a
        // smooth fill, which is the point of asking for it.
        const SEGMENTS = 10;
        const lit = Math.round((bar.percent / 100) * SEGMENTS);
        wrap.classList.add('segmented');
        for (let i = 0; i < SEGMENTS; i++) {
            const cell = document.createElement('div');
            cell.className = 'sillynpc-hud-segment';
            if (i < lit) cell.style.background = meterColour(statDef);
            wrap.append(cell);
        }
    } else {
        const fill = document.createElement('div');
        fill.className = 'sillynpc-hud-bar';
        fill.style.width = `${bar.percent}%`;
        fill.style.background = meterColour(statDef);
        wrap.append(fill);
    }

    const text = document.createElement('div');
    text.className = 'sillynpc-hud-bar-text';
    // Underlines already prints the stat name above its rule. Repeating the formatted
    // "Energy: 10/10" here places a second "Energy" over that heading.
    text.textContent = style === 'underline' ? rawValue : label;
    if (style !== 'underline') wrap.append(text);

    row.append(wrap);
    if (style === 'underline') row.append(text);
    return row;
}

/**
 * Space between the portrait's border and the first ring, and between rings, in pixels.
 *
 * One pixel apart is enough to read as separate rings without opening a gap; the first
 * ring is meant to sit on the portrait's edge rather than float away from it.
 */
const RING_GAP = 1;

/**
 * The portrait's own border, which the first ring has to clear.
 *
 * Must match `.sillynpc-hud-portrait`'s border-width. It said 2 for a while after that
 * border was thinned to 1, so every ring sat a pixel further out than it was meant to and
 * the panel reserved a pixel of padding for space nothing occupied.
 */
const PORTRAIT_BORDER = 1;

/**
 * How far outside the portrait the rings reach, in pixels.
 *
 * Computed rather than fixed, because it depends on how many meters there are and how
 * thick they are drawn. A constant meant the rings either floated far from the portrait
 * with one meter, or ran off the panel with three thick ones.
 *
 * @param {number} count How many rings will be drawn.
 * @param {number} thickness Ring thickness in pixels.
 * @returns {number}
 */
export function ringOverhang(count, thickness) {
    if (count <= 0) return 0;
    return PORTRAIT_BORDER + count * (thickness + RING_GAP);
}

/**
 * The centre-line radius of ring `index`, in pixels.
 *
 * Exported so the test measures the real rule rather than a copy of it. A previous test
 * reimplemented the geometry inline and went on passing while the code it described was
 * wrong - the second and third rings were being drawn across the portrait.
 *
 * @param {number} size Portrait size in pixels.
 * @param {number} thickness Ring thickness in pixels.
 * @param {number} index
 * @returns {number}
 */
export function ringRadius(size, thickness, index) {
    return size / 2 + PORTRAIT_BORDER + RING_GAP + thickness / 2 + index * (thickness + RING_GAP);
}

/**
 * Draws the meters as one ring around the portrait, divided into a segment per stat.
 *
 * This replaced concentric rings - one ring per stat, stacked outward. Those grew the
 * panel with every stat added and were unreadable past three, because each new ring had to
 * clear the last. Segments share a single circumference instead, so a fourth stat makes
 * the segments shorter rather than the HUD wider.
 *
 * The ring takes the portrait's shape: a circle around a circle, a square around a square.
 * `pathLength="100"` normalises either outline so a dash length is a percentage directly,
 * which is what lets one routine draw both.
 *
 * @param {HTMLElement} portrait
 * @param {Array<{ statDef: object, rawValue: string, bar: object }>} meters
 * @param {object} options
 * @param {boolean} options.square Whether the portrait is square.
 * @param {number} options.size Portrait size in pixels.
 * @param {number} options.thickness Ring thickness in pixels.
 */
export function paintSplitRing(portrait, meters, { square, size, thickness }) {
    portrait.querySelectorAll('.sillynpc-hud-rings').forEach(el => el.remove());
    if (!meters.length) return;

    const overhang = ringOverhang(1, thickness);
    const radius = ringRadius(size, thickness, 0);
    const box = size + overhang * 2;
    const centre = box / 2;

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'sillynpc-hud-rings');
    svg.setAttribute('viewBox', `0 0 ${box} ${box}`);

    const outline = () => {
        if (!square) {
            const circle = document.createElementNS(NS, 'circle');
            circle.setAttribute('cx', String(centre));
            circle.setAttribute('cy', String(centre));
            circle.setAttribute('r', String(radius));
            return circle;
        }
        const rect = document.createElementNS(NS, 'rect');
        rect.setAttribute('x', String(centre - radius));
        rect.setAttribute('y', String(centre - radius));
        rect.setAttribute('width', String(radius * 2));
        rect.setAttribute('height', String(radius * 2));
        // No rx. Square means square, and rounding by the thickness made the ring less
        // square the thicker it was drawn - the opposite of what the option is chosen for.
        return rect;
    };

    // A gap between neighbours so the segments read as separate meters rather than as one
    // ring in changing colours.
    //
    // It has to grow with the thickness. The gap is in path units - hundredths of the
    // circumference - while a round cap sticks out by half the stroke width in real
    // pixels at each end, so two neighbours eat a whole stroke width of the space between
    // them. At a thin ring a flat 4 was plenty; at the thickest the caps closed it
    // completely and the segments ran together. A square ring uses butt caps and needs
    // none of that, only enough to be seen.
    const perimeter = square ? 8 * radius : 2 * Math.PI * radius;
    const capUnits = (square ? 0 : thickness) / perimeter * 100;
    const slice = 100 / meters.length;
    // Never more than half the slice, or six stats would be more gap than meter.
    const gap = Math.min(slice * 0.5, Math.max(4, capUnits + 2));
    const span = slice - gap;

    meters.forEach((meter, index) => {
        const offset = -index * slice;
        const filled = Math.max(0, Math.min(100, meter.bar.percent));

        const track = outline();
        track.setAttribute('class', 'sillynpc-hud-ring-track');
        track.setAttribute('stroke-width', String(thickness));
        track.setAttribute('pathLength', '100');
        track.setAttribute('stroke-dasharray', `${span} ${100 - span}`);
        track.setAttribute('stroke-dashoffset', String(offset));

        const lit = span * filled / 100;
        const arc = outline();
        arc.setAttribute('class', 'sillynpc-hud-ring-arc');
        arc.setAttribute('stroke-width', String(thickness));
        arc.setAttribute('pathLength', '100');
        arc.setAttribute('stroke', meterColour(meter.statDef));
        arc.setAttribute('stroke-dasharray', `${lit} ${100 - lit}`);
        arc.setAttribute('stroke-dashoffset', String(offset));

        const title = document.createElementNS(NS, 'title');
        title.textContent = `${meter.statDef.name}: ${meter.rawValue}`;
        arc.append(title);

        svg.append(track, arc);
    });

    // On the container, not the portrait: custom properties inherit downward, and the
    // panel's padding rule sits above this element rather than below it.
    const container = portrait.closest('.sillynpc-hud-container');
    (container || portrait).style.setProperty('--sillynpc-hud-ring-overhang', `${overhang}px`);
    portrait.append(svg);
}

/**
 * Portrait shape, side and border colour.
 *
 * The side used to be implied by the HUD corner - the two left corners set
 * flex-direction: row-reverse and that was the only way to move it - so a HUD in the top
 * left could not keep its portrait on the right. "Follow the corner" preserves that as a
 * choice rather than as the only behaviour.
 *
 * @param {HTMLElement} container
 * @param {object} settings The tracker settings.
 */
export function applyHudAppearance(container, settings) {
    container.classList.toggle('portrait-square', settings.hudPortraitShape === 'square');

    const width = Number(settings.hudMeterWidth) || 92;
    const height = Number(settings.hudMeterHeight) || 14;
    container.style.setProperty('--sillynpc-hud-meter-width', `${width}px`);
    container.style.setProperty('--sillynpc-hud-meter-height', `${height}px`);

    const side = settings.hudPortraitSide || 'auto';
    container.classList.toggle('portrait-left', side === 'left');
    container.classList.toggle('portrait-right', side === 'right');

    // An empty setting has to clear the property, not write an empty value: the CSS falls
    // back to the theme accent only when the variable is absent.
    if (settings.hudPortraitBorder) {
        container.style.setProperty('--sillynpc-hud-portrait-border', settings.hudPortraitBorder);
    } else {
        container.style.removeProperty('--sillynpc-hud-portrait-border');
    }
}
