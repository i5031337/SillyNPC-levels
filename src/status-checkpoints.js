import { djb2 } from './hash.js';
import { 
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    getThumbnailUrl,
    user_avatar,
    getRequestHeaders
} from '../../../../../script.js';
import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from './settings.js';
import { LOG_PREFIX, debugLog, PROFILE_FIELDS, isStaticField } from './constants.js';

export function bind(deps) {
function getCheckpoints(preset) {
    return Array.isArray(preset?.checkpoints) ? preset.checkpoints : [];
}

/** Base64 for a UTF-8 string. btoa alone throws on anything outside Latin-1, and character
 *  names here are routinely Hungarian. Chunked because spreading a large array into
 *  fromCharCode overflows the call stack. */
function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

/** Counts saves within a session, so two in the same millisecond cannot collide. */
let checkpointSequence = 0;

/**
 * A filename the upload route accepts: alphanumerics, dash and underscore only.
 *
 * The timestamp alone was not unique. Date.now() repeats inside a millisecond, and a
 * restore saves "Before restore" immediately after whatever prompted it - so the two
 * could share a name, the second would overwrite the first, and dropping the older index
 * entry would then delete the file the newer one still pointed at.
 */
function checkpointFileName(system, savedAt) {
    const slug = String(system).replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 40) || 'system';
    const unique = `${savedAt}-${(checkpointSequence++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return `sillynpc-state-${slug}-${unique}.json`;
}

/**
 * Records the live state as a new checkpoint of the active system.
 *
 * Captures configuration as well as the world: "so we cannot screw up permanently a
 * setting" is the point, and a world-only checkpoint would restore your characters while
 * leaving a ruined ruleset in place.
 *
 * @param {string} [label]
 * @returns {Promise<{ saved: boolean, kept: number, reason?: string }>}
 */
async function saveCheckpoint(label = 'Manual save') {
    const settings = getSettings();
    const active = settings.activeSystem;
    const preset = settings.statusTracker.presets?.[active];
    if (!active || !preset) return { saved: false, kept: 0, reason: 'no active system' };

    const payload = {
        config: {
            ...deps.copyExcept(settings, deps.SYSTEM_EXCLUDED_ROOT),
            statusTracker: deps.copyExcept(settings.statusTracker, deps.SYSTEM_EXCLUDED_TRACKER),
        },
        world: deps.captureWorld(settings),
    };
    const serialised = JSON.stringify(payload);

    const history = getCheckpoints(preset);
    // A checkpoint identical to the newest is noise: an interval save on an untouched
    // system would otherwise push real history out a few minutes at a time. Compared by
    // the bytes we are about to write, so it needs no second copy in memory.
    if (history[0]?.size === serialised.length && history[0]?.digest === digestOf(serialised)) {
        return { saved: false, kept: history.length, reason: 'unchanged' };
    }

    const savedAt = Date.now();
    const name = checkpointFileName(active, savedAt);
    let path;
    try {
        const response = await fetch('/api/files/upload', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name, data: toBase64(serialised) }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        path = (await response.json()).path;
    } catch (err) {
        console.warn(LOG_PREFIX, 'Could not write the saved state:', err);
        // No index entry without a file behind it: an entry pointing at nothing offers a
        // restore that cannot work, which is worse than not offering one.
        return { saved: false, kept: history.length, reason: 'write failed' };
    }

    history.unshift({
        id: name,
        savedAt,
        label: String(label || 'Manual save'),
        path,
        characters: (payload.world.characters || []).length,
        size: serialised.length,
        digest: digestOf(serialised),
    });

    const limit = Math.max(1, Number(settings.statusTracker.systemCheckpointsKept) || 5);
    // Files for anything falling off the end go too, or user/files/ grows without bound.
    // Awaited so the caller knows the cleanup finished: left floating, a save that returns
    // before its deletes land reports a state the disk does not yet agree with.
    const dropped = history.slice(limit);
    history.length = Math.min(history.length, limit);
    // Never delete a file another entry still points at. Names are unique now, so this
    // should not arise - but the cost of being wrong is a saved state that restores
    // nothing, and the check is one comparison.
    const stillReferenced = new Set(history.map(entry => entry.path));
    await Promise.all(
        dropped
            .filter(entry => !stillReferenced.has(entry.path))
            .map(entry => deleteCheckpointFile(entry.path)),
    );
    preset.checkpoints = history;

    saveSettings();
    debugLog(`Checkpoint saved for "${active}" (${history.length} kept)`);
    return { saved: true, kept: history.length };
}

/**
 * A cheap fingerprint of a saved state, for spotting one that has not changed.
 *
 * Not a cryptographic hash and does not need to be: a collision costs one skipped save of
 * an identical-looking state, and the length is checked alongside it.
 */
function digestOf(text) {
    return djb2(text);
}

/** Removes a checkpoint's file, ignoring one that has already gone. */
async function deleteCheckpointFile(path) {
    if (!path) return;
    try {
        await fetch('/api/files/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ path }),
        });
    } catch (err) {
        debugLog('Could not delete a saved state file', path, err);
    }
}

/**
 * Puts a checkpoint back.
 *
 * Takes a checkpoint of the current state first, so restoring is itself undoable - the one
 * thing a restore must never be is a one-way door.
 *
 * @param {number} index Into the checkpoint list, newest first.
 * @returns {Promise<boolean>}
 */
async function restoreCheckpoint(index) {
    const settings = getSettings();
    const active = settings.activeSystem;
    const preset = settings.statusTracker.presets?.[active];
    if (!active || !preset) return false;

    const target = getCheckpoints(preset)[Number(index)];
    if (!target) return false;

    let payload;
    try {
        const response = await fetch(target.path.startsWith('/') ? target.path : `/${target.path}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        payload = await response.json();
    } catch (err) {
        console.warn(LOG_PREFIX, 'Could not read the saved state:', err);
        return false;
    }

    // Only after the payload is in hand: a failed read must not cost you a checkpoint slot
    // for a restore that then does not happen.
    await saveCheckpoint('Before restore');

    deps.applySystemPreset({ config: payload.config, world: payload.world });
    saveSettings();
    debugLog(`Restored the state saved at ${new Date(target.savedAt).toLocaleString()}`);
    return true;
}

/**
 * Removes one checkpoint and its file.
 *
 * @param {number} index
 * @returns {Promise<boolean>}
 */
async function deleteCheckpoint(index) {
    const settings = getSettings();
    const preset = settings.statusTracker.presets?.[settings.activeSystem];
    if (!preset) return false;
    const history = getCheckpoints(preset);
    const target = history[Number(index)];
    if (!target) return false;
    history.splice(Number(index), 1);
    preset.checkpoints = history;
    saveSettings();
    await deleteCheckpointFile(target.path);
    return true;
}

let checkpointTimer = null;

/**
 * Starts or stops the interval save, matching the current settings.
 *
 * Idempotent: it clears any existing timer first, so it can be called freely without
 * stacking them up.
 */
function applyCheckpointSchedule() {
    if (checkpointTimer) {
        clearInterval(checkpointTimer);
        checkpointTimer = null;
    }

    const minutes = Number(getSettings().statusTracker.systemAutoSaveMinutes) || 0;
    if (minutes <= 0) return;

    checkpointTimer = setInterval(() => {
        // Silent by design: an interval save that toasts every few minutes is a nuisance,
        // and one that saved nothing because nothing changed has nothing to announce.
        saveCheckpoint('Automatic');
    }, minutes * 60 * 1000);

    debugLog(`Automatic system checkpoints every ${minutes} minute(s)`);
}

/**
 * Deletes a system preset.
 */
function deleteSystemPreset(name) {
    if (!name) return;
    const settings = getSettings();
    if (settings.statusTracker.presets?.[name]) {
        delete settings.statusTracker.presets[name];
        saveSettings();
    }
}

/**
 * Imports a system preset from a JSON string.
 */
function importSystemPreset(jsonText) {
    const profile = JSON.parse(jsonText);
    if (!profile.config || !profile.metadata || !profile.metadata.name) {
        throw new Error('Invalid System Profile format.');
    }
    const settings = getSettings();
    if (!settings.statusTracker.presets) settings.statusTracker.presets = {};
    settings.statusTracker.presets[profile.metadata.name] = profile;
    saveSettings();
    return profile;
}

Object.defineProperties(deps, {
    getCheckpoints: { enumerable: true, configurable: true, get: () => getCheckpoints },
    saveCheckpoint: { enumerable: true, configurable: true, get: () => saveCheckpoint },
    restoreCheckpoint: { enumerable: true, configurable: true, get: () => restoreCheckpoint },
    deleteCheckpoint: { enumerable: true, configurable: true, get: () => deleteCheckpoint },
    applyCheckpointSchedule: { enumerable: true, configurable: true, get: () => applyCheckpointSchedule },
    deleteSystemPreset: { enumerable: true, configurable: true, get: () => deleteSystemPreset },
    importSystemPreset: { enumerable: true, configurable: true, get: () => importSystemPreset },
});
}
