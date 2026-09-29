import { 
    eventSource, 
    event_types, 
} from '../../../../../events.js';
import { getContext } from '../../../../../st-context.js';
import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from '../core/settings.js';
import { LOG_PREFIX, debugLog, PROFILE_FIELDS, isStaticField } from '../core/constants.js';

export function bind(deps) {
function loadStateFromMetadata() {
    // Belongs to a chat that is no longer open, whatever the event order was.
    if (deps.committedState && deps.committedChatId !== deps.currentChatId()) deps.committedState = null;

    let stateToReturn = deps.committedState;
    let stateChanged = false;

    if (!stateToReturn) {
        const metadata = deps.getMetadata();
        if (metadata && metadata[deps.STATE_KEY]) {
            stateToReturn = metadata[deps.STATE_KEY];
            
            // Ensure legacy states have expected structure
            if (!stateToReturn.global) stateToReturn.global = {};
            if (!stateToReturn.characters) stateToReturn.characters = [];
            
            // The chat owns what is here. A different persona is a switch, handled in one
            // place; the same persona means this chat's record is already theirs and
            // nothing outside the chat gets a say in it.
            if (stateToReturn.player) {
                deps.activatePersona(stateToReturn, deps.getCurrentPersonaKey(), deps.getCurrentPersonaName());
            } else {
                // Written before there was a player object at all.
                const name = deps.getCurrentPersonaName();
                const key = deps.getCurrentPersonaKey();
                stateToReturn.player = { name, personaKey: key, ...deps.migrateLegacyPlayer(key, name) };
                stateChanged = true;
            }
        } else {
            const name = deps.getCurrentPersonaName();
            const key = deps.getCurrentPersonaKey();
            stateToReturn = deps.createInitialState();
            stateToReturn.player = { name, personaKey: key, ...deps.createChatPlayerSeed() };
        }
        deps.committedState = stateToReturn;
        deps.committedChatId = deps.currentChatId();
        deps.stateOrigin.set(stateToReturn, deps.committedChatId);
    }

    /* Fills in stats the system declares and repairs their casing. It deliberately does NOT
       remove a stored value whose stat has been deleted: erasing on load would take a stat's
       history with it the moment somebody deletes one by mistake, and a System Profile
       switch changes the schema under a chat without meaning to throw anything away.

       A deleted stat is instead ignored wherever anything reads - the tracker box and both
       prompts go through statsInSystem - so the value simply stops being seen. This comment
       used to promise validation that was never written, which is how a deleted stat came to
       be drawn and sent on every message while being unable to change. */
    const settings = getSettings().statusTracker;

    // Ensure missing global stats from settings are added
    (settings.globalStats || []).forEach(stat => {
        if (stat && stat.name) {
            const existingKey = Object.keys(stateToReturn.global).find(k => k.toLowerCase() === stat.name.toLowerCase());
            if (!existingKey) {
                stateToReturn.global[stat.name] = deps.getInitialStatValue(stat.defaultValue, stat.maxStatValue);
                stateChanged = true;
            } else {
                if (existingKey !== stat.name) {
                    // Non-destructive rename
                    stateToReturn.global[stat.name] = stateToReturn.global[existingKey];
                    delete stateToReturn.global[existingKey];
                    stateChanged = true;
                }
                const clamped = deps.clampToCeiling(stateToReturn.global[stat.name]);
                if (clamped !== stateToReturn.global[stat.name]) {
                    stateToReturn.global[stat.name] = clamped;
                    stateChanged = true;
                }
            }
        }
    });

    // Validate Player stats
    if (stateToReturn.player && stateToReturn.player.stats) {
        // Ensure missing player stats from settings are added
        (settings.playerStats || []).forEach(stat => {
            if (stat && stat.name) {
                const existingKey = Object.keys(stateToReturn.player.stats).find(k => k.toLowerCase() === stat.name.toLowerCase());
                if (!existingKey) {
                    stateToReturn.player.stats[stat.name] = deps.getInitialStatValue(stat.defaultValue, stat.maxStatValue);
                    stateChanged = true;
                } else {
                    if (existingKey !== stat.name) {
                        // Non-destructive rename
                        stateToReturn.player.stats[stat.name] = stateToReturn.player.stats[existingKey];
                        delete stateToReturn.player.stats[existingKey];
                        stateChanged = true;
                    }
                    const clamped = deps.clampToCeiling(stateToReturn.player.stats[stat.name]);
                    if (clamped !== stateToReturn.player.stats[stat.name]) {
                        stateToReturn.player.stats[stat.name] = clamped;
                        stateChanged = true;
                    }
                }
            }
        });
    }

    // Ensure recently_deleted exists
    if (!stateToReturn.recently_deleted) {
        stateToReturn.recently_deleted = {};
        stateChanged = true;
    }

    // The standing-decision lists from before they were scoped per character: collection
    // -> [names], where they are now actor -> collection -> [names]. Ignored on read ever
    // since, so they have been inert - but a chat file carrying a shape nothing
    // understands is a puzzle for whoever opens it next, including us.
    for (const key of ['dismissed', 'protected']) {
        const map = stateToReturn[key];
        if (map && typeof map === 'object' && Object.values(map).some(Array.isArray)) {
            delete stateToReturn[key];
            stateChanged = true;
        }
    }

    stateToReturn.characters.forEach(char => {
        if (!char.stats) {
            char.stats = {};
            stateChanged = true;
        }

        // Optimization: Use a map for existing stats lookup
        const charStatsLower = new Map(Object.keys(char.stats).map(k => [k.toLowerCase(), k]));

        // Ensure missing NPC stats from settings are added
        (settings.npcStats || []).forEach(stat => {
            if (stat && stat.name) {
                const lowerName = stat.name.toLowerCase();
                const existingKey = charStatsLower.get(lowerName);
                if (!existingKey) {
                    char.stats[stat.name] = deps.getInitialStatValue(stat.defaultValue, stat.maxStatValue);
                    charStatsLower.set(lowerName, stat.name);
                    stateChanged = true;
                } else {
                    if (existingKey !== stat.name) {
                        // Non-destructive rename
                        char.stats[stat.name] = char.stats[existingKey];
                        delete char.stats[existingKey];
                        charStatsLower.delete(existingKey.toLowerCase());
                        charStatsLower.set(lowerName, stat.name);
                        stateChanged = true;
                    }
                    const clamped = deps.clampToCeiling(char.stats[stat.name]);
                    if (clamped !== char.stats[stat.name]) {
                        char.stats[stat.name] = clamped;
                        stateChanged = true;
                    }
                }
            }
        });
    });

    // Cleanup hardcoded items from current state
    if (stateToReturn.player && stateToReturn.player.collections) {
        for (const colId in stateToReturn.player.collections) {
            const items = stateToReturn.player.collections[colId];
            if (Array.isArray(items)) {
                const settings = getSettings().statusTracker;
                const colDef = settings.collections.find(c => c.id === colId);
                const primaryField = colDef ? colDef.fields.find(f => f.isPrimary) : { name: 'name' };
                const primaryFieldName = primaryField ? primaryField.name : 'name';
                
                stateToReturn.player.collections[colId] = items.filter(item => {
                    const name = item[primaryFieldName];
                    if (typeof name === 'string' && /^new item \d+$/i.test(name)) {
                        debugLog('Removing hardcoded item from player collection:', name);
                        return false;
                    }
                    return true;
                });
            }
        }
    }

    if (stateChanged) {
        debugLog('State repaired during load, saving back to chat metadata.');
        saveStateToMetadata(stateToReturn, { recordHistory: false });
        eventSource.emit('sillynpc-status-updated', stateToReturn);
    }

    return stateToReturn;
}

/**
 * Saves the current status to chat metadata
 */
/**
 * Commits a state to chat metadata, recording the state it replaces so it can be undone.
 *
 * History used to store the state that had just been written, which is the wrong
 * direction: restoring it would be a no-op. It now stores the *outgoing* state, so
 * popping an entry moves you back one step.
 *
 * @param {StatusState} state
 * @param {{ recordHistory?: boolean, label?: string }} [options]
 *   Pass recordHistory:false for writes that should not become undo points - schema
 *   repairs during load, and the undo operation itself (which would otherwise
 *   immediately re-record what it just reverted).
 */
function saveStateToMetadata(state, options = {}) {
    const { recordHistory = true, label = 'Change', partOfMessage = false } = options;
    const metadata = deps.getMetadata();
    if (!metadata) return;

    // Between chats, SillyTavern leaves the last chat's metadata object in place - a read
    // there hands back whichever story was open before, and a write lands in an object
    // that belongs to nothing and is about to be replaced. Neither is anything anyone
    // asked for, so the write is refused where it can still be said out loud.
    if (!deps.hasOpenChat()) {
        console.warn(LOG_PREFIX, 'Refused to write tracker state with no chat open.');
        return;
    }

    // A state read from one chat must never be written into another. SillyTavern swaps
    // chat_metadata inside getChat() and only fires CHAT_CHANGED after the conversation
    // has been re-rendered, so anything holding a state across that gap is pointing at
    // the wrong file - and this is the write that loses work rather than merely showing
    // the wrong number. A state built fresh is unmarked and always allowed.
    const here = deps.currentChatId();
    const origin = deps.stateOrigin.get(state);
    if (origin !== undefined && origin !== here) {
        console.error(LOG_PREFIX,
            `Refused to write state from chat "${origin}" into "${here}".`);
        return;
    }
    deps.stateOrigin.set(state, here);

    // The very first change in a chat has no committed predecessor in metadata yet -
    // the initial state exists only in the in-memory cache. Fall back to it so that
    // first change is undoable too.
    const previous = metadata[deps.STATE_KEY] ?? deps.committedState;
    if (recordHistory && !partOfMessage && previous) {
        if (!Array.isArray(metadata[deps.HISTORY_KEY])) metadata[deps.HISTORY_KEY] = [];
        const history = metadata[deps.HISTORY_KEY];
        history.push({
            state: structuredClone(previous),
            timestamp: Date.now(),
            label,
        });
        // The rewrite keeps only the immediately previous user change.
        if (history.length > 1) history.splice(0, history.length - 1);
    }

    metadata[deps.STATE_KEY] = state;
    deps.committedState = state;
    deps.committedChatId = deps.currentChatId();

    /* Anything saved here that is not a message being read is a correction: the sheet, the
       item editor, a thread pinned by hand. The swipe base has to learn about it, or
       swiping the newest reply quietly rolls it back along with the reply.

       partOfMessage is the load-bearing half - a reply folded into its own base is a swipe
       that undoes nothing. recordHistory is not: the internal rebuilds pass false, and
       aligning after one of them would change nothing, because a rebuild leaves the state
       equal to the base everywhere the message did not touch. It is here as a guard on
       re-entrancy - the aligner reads through loadStateFromMetadata, which can itself save
       while repairing - and no test distinguishes it, which is why this says so. */
    if (recordHistory && !partOfMessage) {
        try {
            deps.alignSwipeBase?.();
        } catch (err) {
            debugLog('Could not keep the swipe base in step', err);
        }
    }

    getContext()?.saveMetadataDebounced?.();
}

/**
 * Undo history for the current chat, oldest first.
 * @returns {{ state: StatusState, timestamp: number, label: string }[]}
 */
function getHistoryEntries() {
    const history = deps.getMetadata()?.[deps.HISTORY_KEY];
    return Array.isArray(history) ? history.slice(-1) : [];
}

/**
 * Steps back one change.
 * @returns {{ state: StatusState, timestamp: number, label: string } | null}
 *   The entry restored, or null when there is nothing to undo.
 */
function undoLastChange() {
    const metadata = deps.getMetadata();
    const history = metadata?.[deps.HISTORY_KEY];
    if (!Array.isArray(history) || history.length === 0) return null;

    const entry = history.pop();
    history.length = 0;
    saveStateToMetadata(entry.state, { recordHistory: false });
    eventSource.emit('sillynpc-status-updated', entry.state);
    return entry;
}

Object.defineProperties(deps, {
    loadStateFromMetadata: { enumerable: true, configurable: true, get: () => loadStateFromMetadata },
    saveStateToMetadata: { enumerable: true, configurable: true, get: () => saveStateToMetadata },
    getHistoryEntries: { enumerable: true, configurable: true, get: () => getHistoryEntries },
    undoLastChange: { enumerable: true, configurable: true, get: () => undoLastChange },
});
}
