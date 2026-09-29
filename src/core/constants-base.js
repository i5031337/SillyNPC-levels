import { paletteIndexFor } from './hash.js';
/**
 * Detect the extension folder name from this script's URL so the extension keeps
 * working regardless of what the user renamed the folder to.
 * URL pattern: .../extensions/third-party/<folder-name>/index.js
 */
const _scriptUrl = import.meta.url;
// Adjust regex to account for being in a subfolder (src/)
const _match = _scriptUrl.match(/extensions\/(?:third-party\/)?([^/]+)\//);
export const extensionName = _match 
    ? (_scriptUrl.includes('third-party') ? `third-party/${_match[1]}` : _match[1]) 
    : 'third-party/SillyNPC';

export const LOG_PREFIX = '[SillyNPC]';

// Auto-downscale uploaded images to keep extension_settings small.
/**
 * Cap for images stored inline in settings.json, where every pixel is base64 in a file
 * that is rewritten on every save. Small on purpose.
 */
export const IMAGE_MAX_DIMENSION = 256;

/**
 * Cap for images written to disk instead: character portraits and generation references.
 *
 * The 256 cap above was the only one there was, so browsing for a portrait quietly shrank
 * it to thumbnail size - which no longer made sense once portraits went to disk, and made
 * a poor reference image besides. Still bounded, because a reference is base64-encoded
 * into a request where size costs latency and tokens.
 */
export const IMAGE_PORTRAIT_MAX_DIMENSION = 1536;
export const IMAGE_JPEG_QUALITY = 0.85;

// Last-resort avatar used when neither the character nor the user's default
// image is available. Inline SVG keeps the extension self-contained.
export const BUILT_IN_DEFAULT_AVATAR = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 120" preserveAspectRatio="xMidYMid slice">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="#3a3a48"/>' +
            '<stop offset="100%" stop-color="#1c1c25"/>' +
        '</linearGradient></defs>' +
        '<rect width="90" height="120" fill="url(#g)"/>' +
        '<circle cx="45" cy="45" r="20" fill="#7a7a8c" opacity="0.75"/>' +
        '<path d="M5 120 Q15 75 45 75 Q75 75 85 120 Z" fill="#7a7a8c" opacity="0.75"/>' +
    '</svg>',
);

/**
 * Extension version. Keep in sync with manifest.json.
 *
 * This used to be duplicated as defaultSettings.version and doubled as the gate
 * that decided whether migrations ran, so bumping one without the other silently
 * skipped them. Migrations now always run; this value is informational.
 */
export const EXTENSION_VERSION = '0.7.0';

/**
 * Themes shipped by the extension (each has a `.sillynpc-theme-<id>` block in
 * style.css). Anything not in this list is treated as a SillyTavern-native theme
 * and gets the `theme-<id>` class instead.
 *
 * This list was previously hardcoded in three separate modules and had already
 * started to drift.
 * @type {readonly string[]}
 */
export const SILLYNPC_THEMES = Object.freeze([
    'terminal',
    'cyberpunk',
    'monochrome',
    'modern-dark',
    'fantasy-hud',
    'tabletop-parchment',
    'analog-horror',
    'rosewater',
]);

/** Native SillyTavern theme classes we also toggle, used only for cleanup. */
export const NATIVE_THEME_CLASSES = Object.freeze([
    'theme-default', 'theme-compact', 'theme-glass', 'theme-bold',
]);

/**
 * Every theme class this extension may have applied — used to clear stale ones
 * before applying the current theme.
 * @returns {string[]}
 */
export function allThemeClasses() {
    return SILLYNPC_THEMES.map(t => `sillynpc-theme-${t}`).concat(NATIVE_THEME_CLASSES, 'sillynpc-theme-default');
}

/**
 * Resolves a theme id to the class that should be applied.
 * @param {string} theme
 * @returns {string}
 */
export function themeClassFor(theme) {
    // Seamless Native is deliberately kept out of SILLYNPC_THEMES so the theme picker,
    // which prepends it, does not list it twice. But style.css does define ten
    // .sillynpc-theme-default rules, and defines nothing at all for .theme-default - so
    // returning that left the panel transparent and its text on the chat behind it.
    if (theme === 'default') return 'sillynpc-theme-default';
    return SILLYNPC_THEMES.includes(theme) ? `sillynpc-theme-${theme}` : `theme-${theme}`;
}

/**
 * How the floating HUD is laid out. Each has a `.sillynpc-hud-<id>` block in style.css.
 *
 * This replaced a "Meter Style" setting that offered bar, segmented, rings and text. The
 * two were never really independent: in every one of these the shape of the meter and the
 * shape of the frame around it are the same decision - underlines drawn as segmented pips
 * is not a thing anybody wants - so a layout decides both, and there is one setting where
 * there were two.
 *
 * `meters` is which drawing routine the layout needs, and it is the field that keeps this
 * honest: a layout wanting a fifth kind of meter is a layout that needs new code in
 * ui-hud.js, not just a new block of CSS.
 *
 * @type {ReadonlyArray<{id: string, label: string, meters: 'bar'|'pips'|'ring', note: string}>}
 */
export const HUD_LAYOUTS = Object.freeze([
    { id: 'plate', label: 'Bracket Plate', meters: 'bar',
      note: 'A panel with the portrait held at its corners. The closest to how the HUD has always looked.' },
    { id: 'blades', label: 'Stepped Blades', meters: 'bar',
      note: 'One plate cut off at an angle, meters stepping in behind it.' },
    { id: 'fan', label: 'Angled Fan', meters: 'bar',
      note: 'Skewed slashes with nothing behind them, longest at the top. Depends on your stat colours being distinct.' },
    { id: 'brackets', label: 'Corner Brackets', meters: 'bar',
      note: 'No panel at all - four corner marks and thin meters. Lightest over a plain chat, hardest to read over a background image.' },
    { id: 'underline', label: 'Underlines', meters: 'bar',
      note: 'Each stat named, with its meter as a rule beneath it. The only layout where the names are always readable.' },
    { id: 'pips', label: 'Pip Rows', meters: 'pips',
      note: 'Notches rather than a fill, so a small change is a whole cell instead of a pixel.' },
    { id: 'splitring', label: 'Split Ring', meters: 'ring',
      note: 'One ring around the portrait, divided into a segment per stat. Compact enough for a corner.' },
    { id: 'dock', label: 'Edge Dock', meters: 'bar',
      note: 'Docked against the side of the screen with its outer half cut away. Takes the least room of any of them.' },
]);

/** The chosen layout, or the default when the setting holds something unknown. */
export function hudLayoutFor(id) {
    return HUD_LAYOUTS.find(l => l.id === id) || HUD_LAYOUTS[0];
}

/** Every layout class, so switching layouts can clear the one before it. */
export function allHudLayoutClasses() {
    return HUD_LAYOUTS.map(l => `sillynpc-hud-${l.id}`);
}

/**
 * Chatty per-message / per-update logging, off by default.
 *
 * The extension logged on every state load, every stat merge and every HUD
 * refresh, which buried real errors in SillyTavern's console. Errors and warnings
 * are always shown; only the running commentary is gated.
 *
 * Toggle at runtime from DevTools:  window.SILLYNPC_DEBUG = true
 *
 * @param {...any} args
 */
export function debugLog(...args) {
    if (globalThis.SILLYNPC_DEBUG) console.log(LOG_PREFIX, ...args);
}

/**
 * Turns debug logging on or off.
 *
 * The flag stays a global so DevTools can still drive it directly, which is how it worked
 * before there was a setting; this only gives the setting a way to reach it.
 *
 * @param {boolean} enabled
 */
export function setDebugLogging(enabled) {
    globalThis.SILLYNPC_DEBUG = !!enabled;
}

/** Portrait dimensions sent to SillyTavern Image Generation; null keeps its resolution. */
export const PORTRAIT_SHAPES = Object.freeze({
    '3:4': { label: '3:4 - matches avatar frames', pixels: { width: 576, height: 768 } },
    '1:1': { label: '1:1 - square', pixels: { width: 512, height: 512 } },
    '2:3': { label: '2:3 - tall portrait', pixels: { width: 512, height: 768 } },
    '9:16': { label: '9:16 - full length', pixels: { width: 576, height: 1024 } },
    st: { label: "Use SillyTavern's resolution", pixels: null },
});

/** Fallback shape: what the avatar frames and character cards are built around. */
export const DEFAULT_PORTRAIT_SHAPE = '3:4';

/**
 * Accent colours handed out to character cards.
 *
 * Chosen to stay readable on both light and dark chat backgrounds and to be told apart at
 * a glance, since their whole job is separating two speakers mid-scene.
 *
 * @type {readonly string[]}
 */
