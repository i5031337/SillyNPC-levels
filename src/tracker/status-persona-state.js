import { 
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    getThumbnailUrl,
    user_avatar,
    getRequestHeaders
} from '../../../../../../script.js';
import { getContext } from '../../../../../st-context.js';
import { power_user } from '../../../../../power-user.js';
import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from '../core/settings.js';
import { LOG_PREFIX, debugLog, PROFILE_FIELDS, isStaticField } from '../core/constants.js';

export function bind(deps) {
function getCurrentPersonaName() {
    return resolvePersonaAvatarAndName().name;
}

/**
 * How a persona is identified in storage: the avatar file.
 *
 * The display name used to be the key, which meant two personas called the same thing
 * shared one record and renaming a persona orphaned theirs. SillyTavern identifies a
 * persona by its avatar filename and so does the chat's own persona record, so this
 * matches what the rest of the application already believes.
 */
function getCurrentPersonaKey() {
    return resolvePersonaAvatarAndName().avatar;
}

/**
 * Finds a persona's record, accepting the display-name key written before this.
 *
 * Moves what it finds rather than copying it, so the old key stops existing and the
 * migration happens once, on the first read, without a pass over anybody's settings.
 *
 * Two personas sharing a display name means one arbitrary record to inherit and whoever
 * loads first takes it. That ambiguity is what the avatar key removes going forward; it
 * cannot be undone for data already written under it.
 *
 * @param {object} store personaData, or a chat's players map.
 * @param {string} key The avatar filename.
 * @param {string} name The display name, as the record may still be filed under it.
 */
function takePersonaRecord(store, key, name) {
    if (!store || !key) return undefined;
    if (store[key]) return store[key];
    if (name && name !== key && store[name]) {
        store[key] = store[name];
        delete store[name];
        debugLog(`Persona record re-keyed from "${name}" to "${key}"`);
        return store[key];
    }
    return undefined;
}

/**
 * Single source of truth for "which persona is active, and what is it called".
 * @returns {{ avatar: string, name: string }}
 */
function resolvePersonaAvatarAndName() {
    const context = getContext();
    // context has no user_avatar key; the module-level export from script.js is the
    // authoritative value. Keep the context read first in case a future ST adds it.
    const avatar = context?.user_avatar || user_avatar || 'default_user.png';
    const powerUser = power_user || {};
    const name = powerUser.personas?.[avatar] || context?.name1 || 'Player';
    return { avatar, name };
}

/**
 * Initializes persona data in master storage with default values.
 */
function initPersonaData(key, name = key) {
    const settings = getSettings();
    const trackerSettings = settings.statusTracker;
    
    if (!settings.personaData) settings.personaData = {};
    
    const personaData = {
        stats: {},
        collections: {},
        lastUpdated: Date.now()
    };
    
    (trackerSettings.playerStats || []).forEach(stat => {
        if (stat && stat.name) {
            personaData.stats[stat.name] = deps.getInitialStatValue(stat.defaultValue, stat.maxStatValue);
        }
    });
    
    (trackerSettings.collections || []).forEach(col => {
        if (col && col.id && (col.target === 'player' || col.target === 'all')) {
            personaData.collections[col.id] = [];
        }
    });
    
    personaData.name = name;
    settings.personaData[key] = personaData;
    saveSettings();
    return personaData;
}

/** What SillyTavern was told about a persona, however that field is shaped. */
function personaDescription(avatarFilename) {
    const raw = (power_user || {}).persona_descriptions?.[avatarFilename];
    return (typeof raw === 'object' ? raw?.description : raw) || '';
}

/**
 * The player's own character card: their portrait, their description, their lore entry.
 *
 * The fields carry the names a character card uses, so everything built for a character -
 * the portrait block, the lorebook section, the image generator - works on the player
 * without being told who they are. isPlayer is the one thing that has to be said out
 * loud, because the player's facts live at state.player rather than in the scene cast.
 *
 * Kept in the same record as their stats, which means it follows the persona rather than
 * the chat and travels with the world when a system is switched. syncPlayerToMaster
 * rewrites that record on every message, so it carries these across explicitly - a
 * portrait that lasted until the next reply is the failure this has to avoid.
 *
 * @returns {object} The stored record, live: mutate it and call saveSettings().
 */
function getPlayerCard() {
    const { avatar: key, name } = resolvePersonaAvatarAndName();
    const settings = getSettings();
    if (!settings.personaData) settings.personaData = {};

    const record = takePersonaRecord(settings.personaData, key, name) || initPersonaData(key, name);

    record.isPlayer = true;
    record.name = name;
    // No description: the sheet had a box for one and it only ever restated the persona
    // prompt, which the model is already given. The lore entry is where the player is
    // described, exactly as a character is.
    //
    // The portrait is deliberately not seeded from the persona picture either. Separating
    // the two is the point, and a copy would leave them looking joined.
    if (typeof record.imageUrl !== 'string') record.imageUrl = '';
    if (!Array.isArray(record.images)) record.images = [];
    if (record.lorebook === undefined) record.lorebook = null;
    // The same four a character has, so the sheet and the character page can share the
    // blocks that draw them. Field by field, so a record written before a field existed
    // gains it rather than being replaced by a blank set.
    if (!record.profile || typeof record.profile !== 'object') record.profile = {};
    for (const field of PROFILE_FIELDS) {
        if (typeof record.profile[field.id] !== 'string') record.profile[field.id] = '';
    }

    return record;
}

/** The picture to show the player with, or '' when they have not made one. */
function getPlayerImageUrl() {
    try {
        return getPlayerCard().imageUrl || '';
    } catch {
        return '';
    }
}

/** The field that identifies an item within a collection. */
function primaryFieldNameFor(colId) {
    const colDef = (getSettings().statusTracker.collections || []).find(c => c.id === colId);
    return colDef?.fields?.find(f => f.isPrimary)?.name || 'name';
}

/**
 * Merges two maps of collections by primary key, additively.
 *
 * Wholesale replacement is what emptied a persona's inventory, spells and skills across
 * every chat at once. Master and chat used to overwrite each other on load and on save,
 * so a single empty copy anywhere propagated everywhere: open a fresh chat, let one
 * update land, and the items were gone from every chat that persona had ever played.
 *
 * Merging means a copy that has merely forgotten an item cannot delete it. Only an
 * explicit removal - reviewed, or stated outright in an update - can, and that path goes
 * through syncPlayerToMaster with authoritative set.
 *
 * @param {Record<string, object[]>} base Kept in full.
 * @param {Record<string, object[]>} newer Merged over it; wins on individual fields.
 * @returns {Record<string, object[]>}
 */
function mergeCollectionMaps(base, newer) {
    const result = {};
    const ids = new Set([...Object.keys(base || {}), ...Object.keys(newer || {})]);

    for (const colId of ids) {
        const primary = primaryFieldNameFor(colId);
        const keyOf = (item) => String(item?.[primary] ?? item?.name ?? '').trim().toLowerCase();

        const merged = [];
        const seen = new Map();
        for (const source of [base?.[colId] || [], newer?.[colId] || []]) {
            for (const item of source) {
                const key = keyOf(item);
                // A blank primary field is a placeholder row, not an item. One of these
                // was all that survived of a real spell list.
                if (!key) continue;
                if (seen.has(key)) {
                    // A quantity or description that moved on is not reverted by the
                    // older copy, but the item itself is never dropped.
                    Object.assign(seen.get(key), item);
                    continue;
                }
                const copy = structuredClone(item);
                seen.set(key, copy);
                merged.push(copy);
            }
        }
        result[colId] = merged;
    }
    return result;
}

/**
 * Strips rows whose primary field is blank.
 *
 * Adding an item in the library creates an empty row to type into, which is reasonable
 * while editing and meaningless as a stored record.
 */
function dropPlaceholderItems(collections) {
    const result = {};
    for (const [colId, items] of Object.entries(collections || {})) {
        const primary = primaryFieldNameFor(colId);
        result[colId] = (items || []).filter(
            item => String(item?.[primary] ?? item?.name ?? '').trim() !== '');
    }
    return result;
}

/**
 * A persona's starting point in a chat that has never seen them.
 *
 * Master storage is a seed, and only a seed. It used to be copied into the live state
 * every time the persona was reloaded, the sheet was opened, or a chat was switched -
 * replacing that chat's stats wholesale with whichever chat wrote to master last. Two
 * stories with the same character therefore could not hold different states, and the
 * mechanism enforcing that was a silent in-place overwrite: part 2 lost its HP and
 * Energy to part 1 exactly this way.
 *
 * It is read here and nowhere else, so a chat that already knows a persona can never be
 * written over by one that played them elsewhere.
 *
 * @param {string} key The avatar filename identifying the persona.
 * @param {string} [name] Display name, for a record still filed under it.
 * @returns {{ stats: object, collections: object }} A fresh copy, safe to own.
 */
function seedPlayerFromMaster(key, name = key) {
    const settings = getSettings();
    if (!settings.personaData) settings.personaData = {};

    const masterData = takePersonaRecord(settings.personaData, key, name)
        || initPersonaData(key, name);
    debugLog(`Seeding "${name}" into this chat from master storage`);
    return {
        stats: structuredClone(masterData.stats || {}),
        collections: structuredClone(masterData.collections || {}),
    };
}

/**
 * Points state.player at the persona now active, keeping whoever was there.
 *
 * The only function allowed to repoint state.player, so there is one place where a
 * persona change can touch player data and one place to get it right.
 *
 * A chat keeps a record per persona rather than a single slot. Switching to somebody else
 * for a scene and back used to hand the second character the first one's belongings -
 * that is where an officer's watch, a signet ring and a set of journals once changed
 * owner - and there was nowhere for the first character's progress to wait.
 *
 * @param {object} state
 * @param {string} key The avatar filename of the persona now active.
 * @param {string} [name] Their display name; defaults to the key for callers with only one.
 * @returns {boolean} Whether the active persona actually changed.
 */
function activatePersona(state, key, name = key) {
    if (!state || !key) return false;

    // Identity is the avatar; the name is only what it is called. A persona renamed
    // mid-story is still the same character and keeps everything.
    const previousKey = String(state.player?.personaKey ?? state.player?.name ?? '').trim();
    if (previousKey && previousKey === key) {
        state.player.personaKey = key;
        state.player.name = name;
        return false;
    }

    if (!state.players || typeof state.players !== 'object') state.players = {};

    // Whoever was playing keeps what they earned, in this chat, for their return.
    if (previousKey && state.player) {
        state.players[previousKey] = {
            name: state.player.name,
            stats: structuredClone(state.player.stats || {}),
            collections: structuredClone(state.player.collections || {}),
        };
    }

    const known = takePersonaRecord(state.players, key, name);
    const incoming = known
        ? { stats: structuredClone(known.stats || {}), collections: structuredClone(known.collections || {}) }
        : seedPlayerFromMaster(key, name);

    state.player = { name, personaKey: key, stats: incoming.stats, collections: incoming.collections };
    debugLog(`Active persona in this chat: ${name}${known ? ' (restored)' : ' (seeded)'}`);
    return true;
}

/**
 * Synchronizes the player state from the current chat state to master storage.
 */
function syncPlayerToMaster(state, options = {}) {
    if (!state.player) return;

    // Only a state that actually stated its collections may shrink them. A stats-only
    // update, or a plain save after a load, must not be able to empty master - that is
    // the direction the loss travelled in: one chat with nothing in it, and the persona
    // was stripped in every other chat too.
    const { authoritative = false } = options;

    const name = getCurrentPersonaName();
    const key = getCurrentPersonaKey();
    const settings = getSettings();

    if (!settings.personaData) settings.personaData = {};

    const existing = takePersonaRecord(settings.personaData, key, name);
    const incoming = structuredClone(state.player.collections || {});
    const collections = authoritative
        ? dropPlaceholderItems(incoming)
        : mergeCollectionMaps(existing?.collections || {}, incoming);

    // There was a ten-slot rollback ring here, taking a snapshot whenever the item count
    // dropped. It never fired for the loss it was meant to catch: stats going wrong is not
    // an item count changing, so when a story's HP and Energy were overwritten the ring
    // held nothing at all. Recovery came from the per-message records instead, and those
    // now have a way in - see restorePlayerFromMessage. A blind buffer nobody can inspect
    // earns nothing beside a list of points you can read and choose between.

    debugLog(`Syncing player data UP for persona "${name}"`, { authoritative });
    settings.personaData[key] = {
        // Whatever else the record held comes first. This write replaces it outright, so
        // without carrying them the player's portrait, description and lore link would
        // last exactly until their next message.
        ...(existing || {}),
        name,
        stats: structuredClone(state.player.stats),
        collections,
        lastUpdated: Date.now()
    };
    saveSettings();
}

/**
 * @typedef {Object} CollectionItem
 * @property {string} [id] - Optional unique identifier
 * @property {Record<string, any>} fields - Field values defined in settings
 */

/**
 * @typedef {Object} ActorState
 * @property {string} name
 * @property {Record<string, string>} stats
 * @property {Record<string, CollectionItem[]>} collections
 * @property {string} [boundTo] - For scene binding
 */

/**
 * @typedef {Object} StatusState
 * @property {Record<string, string>} global
 * @property {ActorState[]} characters
 * @property {ActorState} player
 * @property {number} timestamp
 */


Object.defineProperties(deps, {
    getCurrentPersonaName: { enumerable: true, configurable: true, get: () => getCurrentPersonaName },
    getCurrentPersonaKey: { enumerable: true, configurable: true, get: () => getCurrentPersonaKey },
    resolvePersonaAvatarAndName: { enumerable: true, configurable: true, get: () => resolvePersonaAvatarAndName },
    personaDescription: { enumerable: true, configurable: true, get: () => personaDescription },
    getPlayerCard: { enumerable: true, configurable: true, get: () => getPlayerCard },
    getPlayerImageUrl: { enumerable: true, configurable: true, get: () => getPlayerImageUrl },
    mergeCollectionMaps: { enumerable: true, configurable: true, get: () => mergeCollectionMaps },
    seedPlayerFromMaster: { enumerable: true, configurable: true, get: () => seedPlayerFromMaster },
    activatePersona: { enumerable: true, configurable: true, get: () => activatePersona },
    syncPlayerToMaster: { enumerable: true, configurable: true, get: () => syncPlayerToMaster },
});
}
