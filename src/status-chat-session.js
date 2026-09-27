import { 
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    getThumbnailUrl,
    user_avatar,
    getRequestHeaders
} from '../../../../../script.js';
import { 
    eventSource, 
    event_types, 
} from '../../../../events.js';
import { getContext } from '../../../../st-context.js';
import { setUserAvatar, getUserAvatar } from '../../../../personas.js';
import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from './settings.js';
import { getAllCharacters, getLibraryCharacters } from './character-repository.js';
import { LOG_PREFIX, debugLog, fieldsForCard, isStaticField } from './constants.js';
import { syncProfileToLore } from './lore-sync.js';

export function bind(deps) {
const STATE_KEY = 'sillynpc_status_state';
const HISTORY_KEY = 'sillynpc_status_history';
const SWIPE_BASE_KEY = 'sillynpc_swipe_base';

/** @type {StatusState | null} */
let committedState = null;

/**
 * The chat committedState was read from.
 *
 * The cache is only ever valid for one chat, and CHAT_CHANGED is too late to be the thing
 * that says so: SillyTavern swaps chat_metadata inside getChat() and only fires the event
 * after printMessages() has already rendered the whole conversation. For that entire pass
 * the new chat's metadata is live while this still holds the previous chat's state - so
 * every status box, and the HUD, read the chat you just left. Worse, a state repaired
 * during that window was saved back, writing the old chat's values into the new chat.
 *
 * Keyed on the chat instead, the cache invalidates itself the moment the chat does.
 *
 * @type {string | undefined}
 */
let committedChatId;

/** @returns {string|undefined} Undefined between chats, which is a value like any other. */
function currentChatId() {
    return getContext()?.getCurrentChatId?.();
}

/**
 * Which chat each live state object was read from.
 *
 * Invalidating the read cache stops a stale state being handed out, but it cannot stop
 * one already handed out from being saved after the chat has moved on - and that is the
 * write that does real damage, because it puts one chat's values into another chat's
 * file. It is how a story lost its HP and Energy to the story opened before it.
 *
 * A WeakMap rather than a field on the state: this must not be serialised into the chat
 * file, survive a structuredClone, or be something an update object could carry.
 *
 * @type {WeakMap<object, string|undefined>}
 */
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

/**
 * The tracker state as it stood before the newest message was read.
 *
 * Swiping replaces the newest reply with another one, and the changes already applied
 * describe the reply you swiped away from. Rebuilding from the state before that message
 * is what lets a different swipe be applied cleanly instead of stacking on top.
 *
 * One slot, overwritten when the next message is read. Only the newest message can be
 * swiped in SillyTavern - the handlers are bound to `.last_mes` - so a second entry could
 * never be consulted, and a snapshot per message would put megabytes in a long chat file.
 *
 * @param {string|number} messageId
 * @param {StatusState} state The state before this message's changes are applied.
 */
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

/**
 * Every profile, by character name, as they stand right now.
 *
 * Rides the swipe base because a profile field the reader is allowed to change does not
 * live in the state - it lives on the card, in settings, shared by every chat. So the
 * rebase cannot rebuild it the way it rebuilds a stat, and without a snapshot a rewritten
 * personality would survive the swipe that undid everything else about that reply.
 *
 * Four short strings per character. The state clone beside it is far larger.
 */
function snapshotProfiles() {
    const out = {};
    const record = (card) => {
        const name = String(card?.name ?? '').trim();
        if (name) out[name.toLowerCase()] = { ...(card.profile || {}) };
    };
    for (const card of getAllCharacters()) record(card);
    try { record(deps.getPlayerCard()); } catch { /* no persona yet */ }
    return out;
}

/**
 * Puts every profile back to how the snapshot found it.
 *
 * Only the fields that actually differ, so a card nobody touched is not rewritten and
 * saveSettings is not called for nothing.
 *
 * @returns {number} How many fields were put back.
 */
function restoreProfiles(profiles) {
    if (!profiles || typeof profiles !== 'object') return 0;

    let restored = 0;
    const touched = new Set();
    const put = (card) => {
        const was = profiles[String(card?.name ?? '').trim().toLowerCase()];
        if (!was) return;
        if (!card.profile || typeof card.profile !== 'object') card.profile = {};
        for (const field of fieldsForCard(card)) {
            const before = String(was[field.id] ?? '');
            if (String(card.profile[field.id] ?? '') === before) continue;
            card.profile[field.id] = before;
            restored += 1;
            touched.add(card);
        }
    };
    for (const card of getAllCharacters()) put(card);
    try { put(deps.getPlayerCard()); } catch { /* no persona yet */ }

    if (restored) {
        saveSettings();
        for (const card of touched) syncProfileToLore(card).catch(err =>
            console.error(LOG_PREFIX, 'Could not restore lorebook fields after swipe', err));
        debugLog(`Put ${restored} profile field(s) back to before that message`);
    }
    return restored;
}

/**
 * The remembered state for a message, or null when there is none.
 *
 * Missing after a reload, or for a message written before this existed. The caller has to
 * say so rather than guess: applying a swipe's changes on top of numbers that already
 * include a different swipe is the double-counting this exists to prevent.
 *
 * @param {string|number} messageId
 * @returns {StatusState | null}
 */
function getSwipeBase(messageId) {
    const stored = getMetadata()?.[SWIPE_BASE_KEY];
    if (!stored || stored.messageId !== String(messageId)) return null;
    return structuredClone(stored.state);
}

/**
 * The stored base itself, not a copy.
 *
 * Every other reader gets a clone from getSwipeBase, which is what stops a caller
 * accidentally rewriting history. The aligner is the one caller whose whole job is to
 * rewrite it, so it needs the real thing.
 *
 * @returns {{ messageId: string, state: object, profiles: object }|null}
 */
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
    initStatusLogic: { enumerable: true, configurable: true, get: () => initStatusLogic },
    PERSONA_KEY: { enumerable: true, configurable: true, get: () => PERSONA_KEY },
    hasOpenChat: { enumerable: true, configurable: true, get: () => hasOpenChat },
    getChatPersona: { enumerable: true, configurable: true, get: () => getChatPersona },
    rememberChatPersona: { enumerable: true, configurable: true, get: () => rememberChatPersona },
    restoreChatPersona: { enumerable: true, configurable: true, get: () => restoreChatPersona },
    SYSTEM_KEY: { enumerable: true, configurable: true, get: () => SYSTEM_KEY },
    getChatSystem: { enumerable: true, configurable: true, get: () => getChatSystem },
    rememberChatSystem: { enumerable: true, configurable: true, get: () => rememberChatSystem },
    restoreChatSystem: { enumerable: true, configurable: true, get: () => restoreChatSystem },
});
}
