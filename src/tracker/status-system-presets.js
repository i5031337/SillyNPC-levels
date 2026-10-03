import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from '../core/settings.js';
import { normaliseNpcPersistence, canTrackerSetNpcStat } from './stat-persistence.js';
import { normaliseStatUpdatePolicies } from './stat-update-policy.js';
import { LOG_PREFIX, debugLog, PROFILE_FIELDS, isStaticField } from '../core/constants.js';
import { normalizeSystemDefinition } from '../core/system-schema.js';

export function bind(deps) {
const SYSTEM_EXCLUDED_ROOT = new Set([
    // Characters, persona records, and items are not System rules.
    'characters', 'personaData', 'master_items',
    // The library itself, and which system is open.
    'statusTracker', 'activeSystem', 'version', 'enabled',
    // User-level image settings, including retired backend keys from old exports.
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
    // Ignore retired checkpoint settings in old exported profiles.
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

/** Existing Builder/reader controls still consume their flat tracker configuration. */
function configFromDefinition(definition) {
    const stat = fields => fields.map(field => ({
        ...field,
        name: field.name,
        hint: field.guidance,
    }));
    const collections = definition.collections.map(collection => ({
        ...collection,
        fields: collection.fields.map(field => ({ ...field, hint: field.guidance })),
    }));
    return {
        statusTracker: {
            globalStats: stat(definition.stats.world),
            playerStats: stat(definition.stats.player),
            npcStats: stat(definition.stats.npc),
            collections,
            hudLayout: definition.hud.layout,
            showGlobalStats: definition.hud.showWorld,
            showNpcPortraits: definition.hud.showNpcPortraits,
        },
    };
}

/** Convert a saved/imported profile at one boundary; discard embedded world data. */
function migratePreset(name, preset) {
    if (!preset || typeof preset !== 'object') return preset;
    const clean = { ...preset };
    delete clean.world;
    clean.metadata = clean.metadata || {
        name: name || clean.name || 'System', description: '', author: 'User',
    };
    clean.metadata = { ...clean.metadata, name };
    if (clean.config) {
        clean.config = copyExcept(clean.config, new Set(['characters', 'personaData', 'master_items', 'systemWorldArchive']));
        if (clean.config.statusTracker) clean.config.statusTracker = copyExcept(clean.config.statusTracker, SYSTEM_EXCLUDED_TRACKER);
    }
    clean.definition = normalizeSystemDefinition(preset.definition || preset, { name });
    if (!clean.config) clean.config = configFromDefinition(clean.definition);
    return clean;
}

function migrateSavedPresets(settings) {
    const presets = settings.statusTracker?.presets || {};
    let changed = false;
    for (const [name, preset] of Object.entries(presets)) {
        if (!preset || (Array.isArray(preset.definition?.npcTemplates) && !preset.world
            && !['characters', 'personaData', 'master_items', 'systemWorldArchive']
                .some(key => Object.hasOwn(preset.config || {}, key)))) continue;
        presets[name] = migratePreset(name, preset);
        changed = true;
    }
    const active = presets[settings.activeSystem]?.definition;
    if (active) {
        for (const stat of settings.statusTracker.npcStats || []) {
            if (!stat.id) stat.id = active.stats.npc.find(field => field.name === stat.name)?.id;
        }
    }
    if (changed) saveSettings();
    return changed;
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
 * configuration built from "Energy RPG" is still recognisably that system.
 * With no match, the live configuration becomes a system of its own.
 *
 * @returns {boolean} Whether a migration happened.
 */
function migrateToActiveSystem() {
    const settings = getSettings();
    migrateSavedPresets(settings);
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
 * Makes a system the one in use.
 *
 * @returns {boolean} False when there is no such system, or it is already active.
 */
function setActiveSystem(name) {
    const settings = getSettings();
    migrateSavedPresets(settings);
    const target = settings.statusTracker.presets?.[name];
    if (!target || settings.activeSystem === name) return false;
    // A chat adopts its first System on open. Restoring that recorded System is allowed;
    // selecting another one here would reinterpret live values without a field mapping.
    if (deps.chatHasStarted?.() && deps.getChatSystem?.() !== name) return false;

    captureActiveSystem();
    applySystemPreset(target);
    settings.activeSystem = name;
    if (deps.hasOpenChat?.() && !deps.chatHasStarted?.()
        && deps.getChatSystem?.() !== name) deps.resetUnplayedChatState?.();
    deps.rememberChatSystem?.();
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
    if (deps.chatHasStarted?.()) return false;

    captureActiveSystem();

    // Reset by the same rule the capture uses, so a new system starts from the defaults in
    // everything it owns. Resetting a named handful meant time rules, prompts and review
    // thresholds quietly carried over from whichever system you happened to be in.
    const defaults = structuredClone(defaultSettings);
    assignExcept(st, defaults.statusTracker, SYSTEM_EXCLUDED_TRACKER);
    assignExcept(settings, defaults, SYSTEM_EXCLUDED_ROOT);

    saveSystemPreset(name);
    st.presets[name].definition.npcTemplates = [];
    delete st.presets[name].definition.legacyNpcTemplateId;
    settings.activeSystem = name;
    if (deps.hasOpenChat?.() && !deps.chatHasStarted?.()
        && deps.getChatSystem?.() !== name) deps.resetUnplayedChatState?.();
    deps.rememberChatSystem?.();
    saveSettings();
    return true;
}

/**
 * Saves the current status tracker configuration as a preset.
 */
function saveSystemPreset(name, description = '', author = 'User') {
    if (!name) return;
    const settings = getSettings();
    migrateSavedPresets(settings);
    const st = settings.statusTracker;
    
    const previous = st.presets?.[name];
    const profile = {
        version: '3.0.0',
        metadata: {
            name,
            description,
            author
        },
        config: {
            ...copyExcept(settings, SYSTEM_EXCLUDED_ROOT),
            statusTracker: copyExcept(st, SYSTEM_EXCLUDED_TRACKER),
        },
    };
    const liveDefinition = normalizeSystemDefinition(profile, { name });
    // Builder still edits the flat stat/collection config. Keep the imported profile
    // schema until Builder has controls for those fields, instead of replacing it with
    // the old fixed field list on the next save or chat switch.
    profile.definition = normalizeSystemDefinition({
        ...liveDefinition,
        profiles: previous?.definition?.profiles || liveDefinition.profiles,
        npcTemplates: previous?.definition?.npcTemplates || liveDefinition.npcTemplates,
        legacyNpcTemplateId: previous ? previous.definition?.legacyNpcTemplateId : liveDefinition.legacyNpcTemplateId,
        memories: previous?.definition?.memories || liveDefinition.memories,
        goals: previous?.definition?.goals || liveDefinition.goals,
    }, { name });

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
    normaliseStatUpdatePolicies(st);
    normaliseNpcPersistence(st.npcStats);
    for (const stat of st.npcStats || []) {
        if (!stat.id) stat.id = profile.definition?.stats?.npc?.find(field => field.name === stat.name)?.id;
    }

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

    saveSettings();
}

function deleteSystemPreset(name) {
    if (!name) return;
    const settings = getSettings();
    if (!settings.statusTracker.presets?.[name]) return;
    delete settings.statusTracker.presets[name];
    saveSettings();
}

function importSystemPreset(jsonText) {
    const profile = JSON.parse(jsonText);
    if (!profile || typeof profile !== 'object'
        || (!profile.config && profile.schemaVersion !== 1 && !profile.definition)
        || !(profile.metadata?.name || profile.name)) {
        throw new Error('Invalid System Profile format.');
    }
    const settings = getSettings();
    if (!settings.statusTracker.presets) settings.statusTracker.presets = {};
    const requested = profile.metadata?.name || profile.name;
    let name = requested;
    for (let number = 2; settings.statusTracker.presets[name]; number++) name = `${requested} (${number})`;
    settings.statusTracker.presets[name] = deps.migratePreset(name, profile);
    saveSettings();
    return settings.statusTracker.presets[name];
}

Object.defineProperties(deps, {
    SYSTEM_EXCLUDED_ROOT: { enumerable: true, configurable: true, get: () => SYSTEM_EXCLUDED_ROOT },
    SYSTEM_EXCLUDED_TRACKER: { enumerable: true, configurable: true, get: () => SYSTEM_EXCLUDED_TRACKER },
    copyExcept: { enumerable: true, configurable: true, get: () => copyExcept },
    migratePreset: { enumerable: true, configurable: true, get: () => migratePreset },
    getActiveSystem: { enumerable: true, configurable: true, get: () => getActiveSystem },
    migrateToActiveSystem: { enumerable: true, configurable: true, get: () => migrateToActiveSystem },
    setActiveSystem: { enumerable: true, configurable: true, get: () => setActiveSystem },
    createSystem: { enumerable: true, configurable: true, get: () => createSystem },
    saveSystemPreset: { enumerable: true, configurable: true, get: () => saveSystemPreset },
    applySystemPreset: { enumerable: true, configurable: true, get: () => applySystemPreset },
    deleteSystemPreset: { enumerable: true, configurable: true, get: () => deleteSystemPreset },
    importSystemPreset: { enumerable: true, configurable: true, get: () => importSystemPreset },
});
}
