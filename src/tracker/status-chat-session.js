import { 
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    getThumbnailUrl,
    user_avatar,
    getRequestHeaders
} from '../../../../../../script.js';
import { 
    eventSource, 
    event_types, 
} from '../../../../../events.js';
import { getContext } from '../../../../../st-context.js';
import { setUserAvatar, getUserAvatar } from '../../../../../personas.js';
import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from '../core/settings.js';
import { getAllCharacters, getLibraryCharacters } from '../characters/character-repository.js';
import { LOG_PREFIX, debugLog, isStaticField } from '../core/constants.js';
import { diffTurnValues, applyTurnValues } from './snapshots/status-turn-delta.js';

export function bind(deps) {
const STATE_KEY = 'sillynpc_status_state';
const HISTORY_KEY = 'sillynpc_status_history';
const SWIPE_BASE_KEY = 'sillynpc_swipe_base';

/** @type {StatusState | null} */
let committedState = null;

/** The cache's chat ID. CHAT_CHANGED fires after new metadata is already visible, so
 * reads must invalidate the cache by ID rather than wait for that event. */
let committedChatId;

/** @returns {string|undefined} Undefined between chats, which is a value like any other. */
function currentChatId() {
    return getContext()?.getCurrentChatId?.();
}

/** Origin chat for a live state object. The WeakMap keeps this guard out of saved data. */
const stateOrigin = new WeakMap();

// Common RPG stat synonyms to handle different AI output styles
const STAT_SYNONYMS = {
    // NOTE: deliberately no *_max / *_current entries here. Those address one half of
    // a "cur/max" value and are handled by splitStatKeyPart(); listing them as synonyms
    // made hp_max and hp_current both write the whole HP stat, so whichever the model
    // emitted last silently destroyed the other.
    'hp': ['health', 'hitpoints', 'life'],
    'energy': ['mana', 'mp', 'essence', 'power', 'stamina'],
    'condition': ['status', 'state', 'conditions', 'status_effects', 'effect']
};

/**
 * Robustly gets persona avatar and description from ST context.
 * Uses official ST persona management structures and utility functions.
 */
function getPersonaData() {
    const { avatar: avatarFilename, name: officialName } = deps.resolvePersonaAvatarAndName();

    const officialDescription = deps.personaDescription(avatarFilename);
    
    // 3. Native Asset Loading
    //
    // Two URLs, because the two consumers want different things. SillyTavern renders
    // persona thumbnails at 96x144 (config.yaml), which is right for the 60px HUD circle
    // and visibly soft anywhere larger - a 768x1408 avatar arrives at an eighth of its
    // resolution. Anything bigger than a favicon should ask for the file itself.
    const FALLBACK_AVATAR = '../../../../../img/twemoji/1f464.png'; // Default silhouette
    let avatarUrl = FALLBACK_AVATAR;
    let avatarThumbUrl = FALLBACK_AVATAR;

    if (avatarFilename && avatarFilename !== 'default_user.png') {
        avatarThumbUrl = getThumbnailUrl('persona', avatarFilename);
        avatarUrl = `/User Avatars/${encodeURIComponent(avatarFilename)}`;
    }

    const result = {
        name: officialName,
        avatar: avatarFilename,
        avatarUrl: avatarUrl,
        avatarThumbUrl: avatarThumbUrl,
        description: officialDescription,
        method: 'official-st-lookup'
    };

    return result;
}

/**
 * Returns the chat metadata object that SillyTavern persists alongside the chat.
 *
 * The context key is `chatMetadata` — there is no `window.chat_metadata`, and no
 * `context.chat_metadata`. Reading either of those returned a throwaway object
 * literal, so every state write went to garbage and nothing survived a reload.
 */
function getMetadata() {
    return getContext()?.chatMetadata ?? null;
}

/** One pre-turn base per chat; only the latest reply can be swiped. */
function rememberSwipeBase(messageId, state) {
    const metadata = getMetadata();
    if (!metadata || !state) return false;

    const key = String(messageId);
    // Only the first read of a message sets it. A later swipe of the same message must
    // rebuild from the same starting point, not from what the previous swipe produced.
    if (metadata[SWIPE_BASE_KEY]?.messageId === key) return false;

    metadata[SWIPE_BASE_KEY] = {
        messageId: key,
        state: structuredClone(state),
        profiles: snapshotProfiles(),
    };
    debugLog(`Remembered the state before message ${key}, for swipes`);
    return true;
}

/** Profile and memory snapshots for cards visible to this chat. */
function snapshotProfiles() {
    const out = {};
    const record = (card) => {
        const name = String(card?.name ?? '').trim();
        if (name) out[name.toLowerCase()] = {
            profile: structuredClone(card.profile || {}),
            memories: structuredClone(card.memories || []),
        };
    };
    for (const card of getAllCharacters()) record(card);
    try { record(deps.getPlayerCard()); } catch { /* no persona yet */ }
    return out;
}

/** Restores profile and memory values without saving unchanged cards. */
function restoreProfiles(profiles) {
    if (!profiles || typeof profiles !== 'object') return 0;

    let restored = 0;
    const touched = new Set();
    const put = (card) => {
        const was = profiles[String(card?.name ?? '').trim().toLowerCase()];
        if (!was) return;
        // Older bases stored the profile directly; new bases include memories too.
        const profile = was.profile && typeof was.profile === 'object' ? was.profile : was;
        if (JSON.stringify(card.profile || {}) !== JSON.stringify(profile)) {
            card.profile = structuredClone(profile);
            restored += 1;
            touched.add(card);
        }
        if (Array.isArray(was.memories)
            && JSON.stringify(card.memories || []) !== JSON.stringify(was.memories)) {
            card.memories = structuredClone(was.memories);
            restored += 1;
            touched.add(card);
        }
    };
    for (const card of getAllCharacters()) put(card);
    try { put(deps.getPlayerCard()); } catch { /* no persona yet */ }

    if (restored) {
        saveSettings();
        debugLog(`Put ${restored} profile field(s) back to before that message`);
    }
    return [...touched];
}

/** The pre-turn state for this message, when available. */
function getSwipeBase(messageId) {
    const stored = getMetadata()?.[SWIPE_BASE_KEY];
    if (!stored || stored.messageId !== String(messageId)) return null;
    return structuredClone(stored.state);
}

/** Mutable base for recording turn effects and manual corrections. */
function swipeBaseRecord() {
    return getMetadata()?.[SWIPE_BASE_KEY] ?? null;
}

/**
 * Keeps the swipe base in step with changes nobody's message made.
 *
 * Registered from index.js rather than imported, because the aligner lives in
 * status-snapshots.js - which already imports this module, and a second edge the other way
 * would be a cycle. The same shape as setReprocessCallback.
 *
 * @type {null|(() => number)}
 */
let alignSwipeBase = null;

/** @param {null|(() => number)} fn */
function setSwipeBaseAligner(fn) {
    alignSwipeBase = typeof fn === 'function' ? fn : null;
}

/** The profiles as they stood before that message, or null when none were recorded. */
function getProfileBase(messageId) {
    const stored = getMetadata()?.[SWIPE_BASE_KEY];
    if (!stored || stored.messageId !== String(messageId)) return null;
    return stored.profiles ? structuredClone(stored.profiles) : null;
}

/** Records all turn-owned writes, including goals, presence and profile memories. */
function recordTurnEffects(messageId) {
    const base = swipeBaseRecord();
    const message = getContext()?.chat?.[Number(messageId)];
    if (!base || base.messageId !== String(messageId) || !message) return false;
    const state = structuredClone(deps.loadStateFromMetadata());
    const profiles = snapshotProfiles();
    const effectsState = base.beforeApply
        ? applyTurnValues(base.state, diffTurnValues(base.beforeApply.state, state)) : state;
    const effectsProfiles = base.beforeApply
        ? applyTurnValues(base.profiles, diffTurnValues(base.beforeApply.profiles, profiles)) : profiles;
    message.extra ||= {};
    base.turnId ||= globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    message.extra.sillynpc_turn_id = base.turnId;
    message.extra.sillynpc_turn_effects = {
        swipe: Number(message.swipe_id ?? 0),
        text: String(message.mes ?? ''),
        state: diffTurnValues(base.state, effectsState),
        profiles: diffTurnValues(base.profiles, effectsProfiles),
    };
    base.applied = { state: effectsState, profiles: effectsProfiles };
    delete base.beforeApply;
    return true;
}

/** Keeps edits made while the reader was waiting outside its reply-owned changes. */
function refreshTurnBase(messageId) {
    const base = swipeBaseRecord();
    if (!base || base.messageId !== String(messageId)) return false;
    const state = structuredClone(deps.loadStateFromMetadata());
    const profiles = snapshotProfiles();
    if (base.applied) base.beforeApply = { state, profiles };
    else {
        base.state = state;
        base.profiles = profiles;
    }
    return true;
}


/**
 * Initialize status tracker logic
 */
function initStatusLogic() {
    debugLog('Initializing Status Tracker Logic');
    // Before anything reads configuration, so the world in use belongs to a system.
    deps.migrateToActiveSystem();
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.GENERATION_STARTED, deps.onGenerationStarted);
    eventSource.on(event_types.PERSONA_CHANGED, onPersonaChanged);
    eventSource.on(event_types.CHARACTER_EDITED, onCharacterEdited);
}

/** Where a chat records which persona was last used in it. */
const PERSONA_KEY = 'sillynpc_persona';

/**
 * Whether a chat is actually open. SillyTavern returns undefined between chats, which is
 * the only reliable signal - the chat array is left populated after one closes.
 */
function hasOpenChat() {
    return getContext()?.getCurrentChatId?.() !== undefined;
}

/** The persona this chat was last used with, or null if it has never recorded one. */
function getChatPersona() {
    const avatar = getMetadata()?.[PERSONA_KEY];
    return (typeof avatar === 'string' && avatar) ? avatar : null;
}

/**
 * Records the persona in use against the open chat.
 *
 * Called whenever you switch persona, which is what makes a change mid-chat stick: the
 * chat remembers whoever you last played it as, not whoever was active when the
 * application last closed.
 *
 * @returns {boolean} False when there was nothing to record.
 */
function rememberChatPersona() {
    const metadata = getMetadata();
    if (!metadata || !hasOpenChat()) return false;

    const { avatar } = deps.resolvePersonaAvatarAndName();
    // A restore also lands here, via the PERSONA_CHANGED it emits - and needs no special
    // case, because it can only ever be writing back the value it just read.
    if (!avatar || metadata[PERSONA_KEY] === avatar) return false;

    metadata[PERSONA_KEY] = avatar;
    getContext()?.saveMetadataDebounced?.();
    debugLog(`Chat persona recorded: ${avatar}`);
    return true;
}

/**
 * Puts a chat back to the persona it was last played with.
 *
 * A chat that has never recorded one adopts whoever is active now, so nothing is guessed
 * about chats that predate this and the first open of an old chat simply claims it.
 *
 * One sharp edge worth knowing: setUserAvatar re-triggers the greeting on an *empty*
 * chat. A chat with no record returns before that point, so it only applies to an empty
 * chat that recorded a different persona earlier - rare, and still the right outcome.
 *
 * @returns {Promise<boolean>} Whether a switch actually happened.
 */
async function restoreChatPersona() {
    if (!hasOpenChat()) return false;

    const recorded = getChatPersona();
    if (!recorded) {
        rememberChatPersona();
        return false;
    }

    const { avatar } = deps.resolvePersonaAvatarAndName();
    if (recorded === avatar) return false;

    try {
        await setUserAvatar(recorded, { toastPersonaNameChange: false });
        debugLog(`Chat persona restored: ${recorded}`);
        return true;
    } catch (err) {
        // A persona deleted since the chat was last opened is the ordinary failure. The
        // chat stays on whoever is active rather than refusing to open.
        console.warn(LOG_PREFIX, 'Could not restore this chat\'s persona', err);
        return false;
    }
}

/** Where a chat records which system it belongs to. */
const SYSTEM_KEY = 'sillynpc_system';

/** The system this chat belongs to, or null if it has never recorded one. */
function getChatSystem() {
    const name = getMetadata()?.[SYSTEM_KEY];
    return (typeof name === 'string' && name) ? name : null;
}

/** A chat can choose its System until the player has sent the first story message. */
function chatHasStarted() {
    return Boolean(getContext()?.chat?.some(message => message?.is_user && !message?.is_system));
}

/** Discard an unplayed chat's old default state when it chooses a different System. */
function resetUnplayedChatState() {
    if (chatHasStarted()) return false;
    const metadata = getMetadata();
    if (!metadata) return false;
    delete metadata[STATE_KEY];
    delete metadata[HISTORY_KEY];
    delete metadata[SWIPE_BASE_KEY];
    committedState = null;
    committedChatId = undefined;
    getContext()?.saveMetadataDebounced?.();
    return true;
}

/** Ties the open chat to the system in use. */
function rememberChatSystem() {
    const metadata = getMetadata();
    if (!metadata || !hasOpenChat()) return false;

    const active = deps.getActiveSystem();
    if (!active || metadata[SYSTEM_KEY] === active) return false;

    metadata[SYSTEM_KEY] = active;
    getContext()?.saveMetadataDebounced?.();
    return true;
}

/**
 * Puts the extension into the system a chat belongs to.
 *
 * This is what makes changing ruleset stop being something you do. Opening a Pathfinder
 * chat brings its stats, its cast and its item library with it; a chat that has never
 * recorded a system adopts the one in use, so nothing is guessed about older chats.
 *
 * @returns {boolean} Whether a switch actually happened.
 */
function restoreChatSystem() {
    if (!hasOpenChat()) return false;

    const recorded = getChatSystem();
    if (!recorded) {
        rememberChatSystem();
        return false;
    }
    if (recorded === deps.getActiveSystem()) return false;

    if (!getSettings().statusTracker.presets?.[recorded]) {
        // Deleted since the chat was last opened. Staying put is the safe reading: the
        // alternative is loading a world at random and writing this chat's state into it.
        console.warn(LOG_PREFIX,
            `This chat belongs to a system that no longer exists: "${recorded}"`);
        return false;
    }
    return deps.setActiveSystem(recorded);
}

async function onChatChanged() {
    committedState = null;
    // System first. It carries the persona records that the restore below reads from, so
    // the other order would match a persona against the outgoing system's storage.
    restoreChatSystem();
    await restoreChatPersona();
}

function onCharacterEdited(data) {
    // A redraw, nothing more. This used to pull master over the chat's player data, so
    // editing a persona's description or picture rewrote their HP - which is not a thing
    // anyone editing a description is asking for.
    const personaName = deps.getCurrentPersonaName();
    if (data && (data.name === personaName || data.name === getContext()?.name1)) {
        debugLog('Current persona edited, redrawing');
        eventSource.emit('sillynpc-status-updated', deps.loadStateFromMetadata());
    }
}

function onPersonaChanged() {
    const state = deps.loadStateFromMetadata();
    // Only writes when the active persona actually changed, so an event fired for a
    // persona that was already active costs nothing and touches nothing.
    if (deps.activatePersona(state, deps.getCurrentPersonaKey(), deps.getCurrentPersonaName())) {
        deps.saveStateToMetadata(state, { label: 'Persona changed' });
        eventSource.emit('sillynpc-status-updated', state);
    }
    rememberChatPersona();
    // index.js will handle the HUD update via its own event listener
}

/**
 * Loads the current status from chat metadata
 */

Object.defineProperties(deps, {
    STATE_KEY: { enumerable: true, configurable: true, get: () => STATE_KEY },
    HISTORY_KEY: { enumerable: true, configurable: true, get: () => HISTORY_KEY },
    committedState: { enumerable: true, configurable: true, get: () => committedState, set: value => { committedState = value; } },
    committedChatId: { enumerable: true, configurable: true, get: () => committedChatId, set: value => { committedChatId = value; } },
    currentChatId: { enumerable: true, configurable: true, get: () => currentChatId },
    stateOrigin: { enumerable: true, configurable: true, get: () => stateOrigin },
    STAT_SYNONYMS: { enumerable: true, configurable: true, get: () => STAT_SYNONYMS },
    getPersonaData: { enumerable: true, configurable: true, get: () => getPersonaData },
    getMetadata: { enumerable: true, configurable: true, get: () => getMetadata },
    rememberSwipeBase: { enumerable: true, configurable: true, get: () => rememberSwipeBase },
    restoreProfiles: { enumerable: true, configurable: true, get: () => restoreProfiles },
    getSwipeBase: { enumerable: true, configurable: true, get: () => getSwipeBase },
    swipeBaseRecord: { enumerable: true, configurable: true, get: () => swipeBaseRecord },
    alignSwipeBase: { enumerable: true, configurable: true, get: () => alignSwipeBase, set: value => { alignSwipeBase = value; } },
    setSwipeBaseAligner: { enumerable: true, configurable: true, get: () => setSwipeBaseAligner },
    getProfileBase: { enumerable: true, configurable: true, get: () => getProfileBase },
    snapshotProfiles: { enumerable: true, configurable: true, get: () => snapshotProfiles },
    recordTurnEffects: { enumerable: true, configurable: true, get: () => recordTurnEffects },
    refreshTurnBase: { enumerable: true, configurable: true, get: () => refreshTurnBase },
    initStatusLogic: { enumerable: true, configurable: true, get: () => initStatusLogic },
    PERSONA_KEY: { enumerable: true, configurable: true, get: () => PERSONA_KEY },
    hasOpenChat: { enumerable: true, configurable: true, get: () => hasOpenChat },
    getChatPersona: { enumerable: true, configurable: true, get: () => getChatPersona },
    rememberChatPersona: { enumerable: true, configurable: true, get: () => rememberChatPersona },
    restoreChatPersona: { enumerable: true, configurable: true, get: () => restoreChatPersona },
    SYSTEM_KEY: { enumerable: true, configurable: true, get: () => SYSTEM_KEY },
    getChatSystem: { enumerable: true, configurable: true, get: () => getChatSystem },
    chatHasStarted: { enumerable: true, configurable: true, get: () => chatHasStarted },
    resetUnplayedChatState: { enumerable: true, configurable: true, get: () => resetUnplayedChatState },
    rememberChatSystem: { enumerable: true, configurable: true, get: () => rememberChatSystem },
    restoreChatSystem: { enumerable: true, configurable: true, get: () => restoreChatSystem },
});
}
