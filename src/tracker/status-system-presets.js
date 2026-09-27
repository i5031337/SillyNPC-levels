import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from '../core/settings.js';
import { normaliseNpcPersistence, canTrackerSetNpcStat } from './stat-persistence.js';
import { LOG_PREFIX, debugLog, PROFILE_FIELDS, isStaticField } from '../core/constants.js';

export function bind(deps) {
const SYSTEM_EXCLUDED_ROOT = new Set([
    // Carried separately, as the world.
    'characters', 'personaData', 'master_items',
    // The library itself, and which system is open.
    'statusTracker', 'activeSystem', 'version', 'enabled',
    // Which provider makes images and where the files land: accounts and disk.
    'imageBackend', 'geminiImageModel', 'imageSaveRoute',
    'loreProfileId', 'imageProfileId',
    // Your window, not your world.
    'popupWidth', 'popupHeight',
]);

const SYSTEM_EXCLUDED_TRACKER = new Set([
    // The library lives inside statusTracker; a system must never contain itself.
    'presets',
    // Which connection reads, what it is capable of, and what it is allowed to spend.
    'extractionProfileId', 'scanProfileId',
    // How often to checkpoint is a habit, not a property of a ruleset.
    'systemAutoSaveMinutes', 'systemCheckpointsKept',
    'extractionMaxTokens', 'scanMaxTokens', 'extractionUseSchema',
    // Whether the tracker runs at all is not a property of a ruleset.
    'enabled',
]);

/** A deep copy of everything except the named keys. */
function copyExcept(source, excluded) {
    const out = {};
    for (const [key, value] of Object.entries(source || {})) {
        if (excluded.has(key)) continue;
        out[key] = structuredClone(value);
    }
    return out;
}

/** Writes a captured block back, skipping anything that block is not allowed to set. */
function assignExcept(target, source, excluded) {
    for (const [key, value] of Object.entries(source || {})) {
        if (excluded.has(key)) continue;
        target[key] = structuredClone(value);
    }
}

/**
 * The part of a system that is not configuration: who exists in it, what they carry, and
 * the player's records.
 *
 * A ruleset without its cast is only half a system. Changing from one to another used to
 * keep every character, the whole item library and the player's stats from the last one,
 * none of which fit - so the choice was to lose the work or live with the mismatch.
 */
function captureWorld(settings) {
    return {
        characters: structuredClone(settings.characters || []),
        personaData: structuredClone(settings.personaData || {}),
        master_items: structuredClone(settings.master_items || {}),
    };
}

/** @param {object|undefined} world Absent on any profile saved before systems carried one. */
function restoreWorld(settings, world) {
    if (!world) return false;
    // Emptied and refilled rather than reassigned: chat.js caches the character list by
    // identity, and replacing the reference would leave it holding the old system's cast.
    const characters = settings.characters;
    characters.splice(0, characters.length, ...structuredClone(world.characters || []));
    settings.personaData = structuredClone(world.personaData || {});
    settings.master_items = structuredClone(world.master_items || {});
    return true;
}

/** Writes the active system back to its slot. Always called before switching away. */
function captureActiveSystem() {
    const settings = getSettings();
    const active = settings.activeSystem;
    const existing = settings.statusTracker.presets?.[active];
    if (!active || !existing) return false;
    saveSystemPreset(active,
        existing.metadata?.description ?? '', existing.metadata?.author ?? 'User');
    return true;
}

/** The system currently in use. */
function getActiveSystem() {
    return getSettings().activeSystem || '';
}

/** What makes one configuration recognisably the same system as another. */
function systemSignature(config) {
    // Either shape: a profile saved since systems carried everything nests its tracker
    // settings, one saved before that holds them flat.
    const tracker = config?.statusTracker || config || {};
    return JSON.stringify([
        (tracker.globalStats || []).map(s => s?.name),
        (tracker.npcStats || []).map(s => s?.name),
        (tracker.playerStats || []).map(s => s?.name),
        (tracker.collections || []).map(c => c?.id),
    ]);
}

function unusedSystemName(presets, base) {
    if (!presets[base]) return base;
    for (let i = 2; ; i++) if (!presets[`${base} ${i}`]) return `${base} ${i}`;
}

/**
 * Gives the configuration already in use a system to belong to.
 *
 * Runs once, when nothing is marked active. The configuration you are working in is
 * matched against the saved systems by which stats and collections it defines - a
 * configuration built from "Energy RPG" is still recognisably that system - so it adopts
 * the current characters and item library rather than a duplicate appearing beside it.
 * With no match, the live configuration becomes a system of its own.
 *
 * Either way the current world goes with it. Nothing is stranded, and nothing is deleted.
 *
 * @returns {boolean} Whether a migration happened.
 */
function migrateToActiveSystem() {
    const settings = getSettings();
    if (settings.activeSystem) return false;

    const st = settings.statusTracker;
    const presets = st.presets || {};
    const live = systemSignature(st);
    const matches = Object.keys(presets)
        .filter(name => systemSignature(presets[name]?.config || {}) === live);

    // Two systems that define the same stats cannot be told apart, so neither is claimed.
    const name = matches.length === 1
        ? matches[0]
        : unusedSystemName(presets, 'Default System');

    const existing = presets[name];
    saveSystemPreset(name,
        existing?.metadata?.description ?? '', existing?.metadata?.author ?? 'User');
    settings.activeSystem = name;
    deps.rememberChatSystem();
    saveSettings();
    debugLog(`Configuration adopted by system: ${name}`);
    return true;
}

/**
 * Makes a system the one in use, carrying its world in with it.
 *
 * The outgoing system is captured first, always. Switching away must never be the thing
 * that loses a world, which is why nothing here depends on having saved by hand.
 *
 * @returns {boolean} False when there is no such system, or it is already active.
 */
function setActiveSystem(name) {
    const settings = getSettings();
    const target = settings.statusTracker.presets?.[name];
    if (!target || settings.activeSystem === name) return false;

    captureActiveSystem();
    applySystemPreset(target);
    // A saved system with no recorded world has an empty one - the starter systems ship
    // that way. Moving into it must not inherit the last system's cast, which is the
    // whole point: a Pathfinder chat should not open holding twenty-five D&D characters.
    // The outgoing world was captured a moment ago, so switching back returns all of it.
    if (!target.world) {
        restoreWorld(settings, { characters: [], personaData: {}, master_items: {} });
    }
    settings.activeSystem = name;
    saveSettings();
    debugLog(`Active system: ${name}`);
    return true;
}

/**
 * Starts a new system from the shipped defaults, with nobody in it.
 *
 * The old flow was "save current as", which asks you to remember to do it and leaves no
 * way to begin from a clean sheet - a new ruleset always started as a copy of the last.
 *
 * @returns {boolean} False when the name is missing or already taken.
 */
function createSystem(name) {
    const settings = getSettings();
    const st = settings.statusTracker;
    if (!name || st.presets?.[name]) return false;

    captureActiveSystem();

    // Reset by the same rule the capture uses, so a new system starts from the defaults in
    // everything it owns. Resetting a named handful meant time rules, prompts and review
    // thresholds quietly carried over from whichever system you happened to be in.
    const defaults = structuredClone(defaultSettings);
    assignExcept(st, defaults.statusTracker, SYSTEM_EXCLUDED_TRACKER);
    assignExcept(settings, defaults, SYSTEM_EXCLUDED_ROOT);

    settings.characters.splice(0, settings.characters.length);
    settings.personaData = {};
    settings.master_items = {};

    saveSystemPreset(name);
    settings.activeSystem = name;
    saveSettings();
    return true;
}

/**
 * Saves the current status tracker configuration as a preset.
 */
function saveSystemPreset(name, description = '', author = 'User') {
    if (!name) return;
    const settings = getSettings();
    const st = settings.statusTracker;
    
    const profile = {
        version: '2.1.0',
        metadata: {
            name,
            description,
            author
        },
        config: {
            ...copyExcept(settings, SYSTEM_EXCLUDED_ROOT),
            statusTracker: copyExcept(st, SYSTEM_EXCLUDED_TRACKER),
        },
        world: captureWorld(settings),
    };

    if (!st.presets) st.presets = {};
    st.presets[name] = profile;
    saveSettings();
}

/**
 * Applies a system preset to the current configuration.
 */
function applySystemPreset(profile) {
    if (!profile || !profile.config) return;
    const st = getSettings().statusTracker;
    const cfg = profile.config;
    
    const settings = getSettings();

    // Two shapes. A profile saved since systems carried everything keeps its tracker
    // settings under `statusTracker`; one saved before that, or exported to share a
    // ruleset, holds a flat handful of tracker keys directly. Both load, and neither
    // touches a setting it does not define.
    if (cfg.statusTracker) {
        assignExcept(st, cfg.statusTracker, SYSTEM_EXCLUDED_TRACKER);
        assignExcept(settings, cfg, new Set([...SYSTEM_EXCLUDED_ROOT, 'displayStyle']));
    } else {
        assignExcept(st, cfg, new Set([...SYSTEM_EXCLUDED_TRACKER, 'displayStyle']));
    }

    // A stat list from an older profile may predate either field.
    for (const stat of st.playerStats || []) {
        if (stat.format === undefined) stat.format = '{{value}}';
        if (stat.maxStatValue === undefined) stat.maxStatValue = '100';
    }

    /* The other door a schema comes through. normalizeSettings runs on load and never sees
       this one, so a system saved before Meter was renamed to Number would arrive holding
       'bar' - and only the systems somebody had saved would misbehave, which is the kind of
       half-migration that takes weeks to be reported. */
    for (const listName of ['globalStats', 'npcStats', 'playerStats']) {
        normaliseStatDefs(st[listName]);
    }
    normaliseNpcPersistence(st.npcStats);

    // The theme was called displayStyle and lived in config; it is menuStyle at the root
    // now, and carried like anything else. Old profiles still name the old one.
    if (cfg.displayStyle !== undefined) {
        const legacyThemeMap = {
            'modern': 'modern-dark',
            'minimal': 'default',
            'compact': 'default'
        };
        settings.menuStyle = legacyThemeMap[cfg.displayStyle] || cfg.displayStyle;
    }

    // Absent on any profile saved before systems carried a world, and on a profile
    // somebody exported to share a ruleset. Both must leave the current cast alone rather
    // than emptying it.
    restoreWorld(getSettings(), profile.world);

    saveSettings();
}

/**
 * Saved states of a system.
 *
 * A system's stored copy is only rewritten when you switch away from it, so a system you
 * never leave keeps whatever it held the last time you did - which is how two deleted
 * characters and a 165KB image stayed frozen inside one for weeks. Checkpoints give it a
 * history instead of a single overwritten copy.
 *
 * The state itself is written to user/files/ and only an index entry - about a hundred
 * bytes - is kept in settings.json. The first version stored the whole thing inline, which
 * would have re-serialised and re-uploaded every saved world on every settings change:
 * five states of a 200KB world is a megabyte rewritten each time a slider moves. The
 * payload never changes after it is written, so it has no business in a file that does.
 *
 * @param {object} preset
 * @returns {Array<{ id: string, savedAt: number, label: string, path: string, characters: number }>}
 */

Object.defineProperties(deps, {
    SYSTEM_EXCLUDED_ROOT: { enumerable: true, configurable: true, get: () => SYSTEM_EXCLUDED_ROOT },
    SYSTEM_EXCLUDED_TRACKER: { enumerable: true, configurable: true, get: () => SYSTEM_EXCLUDED_TRACKER },
    copyExcept: { enumerable: true, configurable: true, get: () => copyExcept },
    captureWorld: { enumerable: true, configurable: true, get: () => captureWorld },
    getActiveSystem: { enumerable: true, configurable: true, get: () => getActiveSystem },
    migrateToActiveSystem: { enumerable: true, configurable: true, get: () => migrateToActiveSystem },
    setActiveSystem: { enumerable: true, configurable: true, get: () => setActiveSystem },
    createSystem: { enumerable: true, configurable: true, get: () => createSystem },
    saveSystemPreset: { enumerable: true, configurable: true, get: () => saveSystemPreset },
    applySystemPreset: { enumerable: true, configurable: true, get: () => applySystemPreset },
});
}
