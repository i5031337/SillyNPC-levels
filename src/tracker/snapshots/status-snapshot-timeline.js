import { getContext } from '../../../../../../st-context.js';
import { getSettings } from '../../core/settings.js';
import { debugLog } from '../../core/constants.js';
import { loadStateFromMetadata, parseMessageForUpdates, saveStateToMetadata, syncPlayerToMaster } from '../status-logic.js';
import { eventSource } from '../../../../../../events.js';
import { getPreservedStatusRaw } from '../status-history.js';
import { splitValue } from '../../core/utils.js';
import { appliedChangesForCurrentSwipe, GLOBALS_KEY, CHARS_KEY } from './status-snapshot-records.js';
import { withMessageEdits } from './status-snapshot-edits.js';

const INVERSE_KIND = {
    'item-add': 'item-remove',
    'item-remove': 'item-add',
};

/** The row that undoes this one. */
function invert(row) {
    return {
        ...row,
        kind: INVERSE_KIND[row.kind] || row.kind,
        before: row.after,
        after: row.before,
    };
}

function actorFor(state, row) {
    if (row.scope === 'player') return state.player;
    if (row.scope === 'character') {
        return (state.characters || []).find(
            c => String(c.name).toLowerCase() === String(row.actor).toLowerCase());
    }
    return null;
}

function primaryOf(collectionId) {
    const colDef = (getSettings().statusTracker.collections || []).find(c => c.id === collectionId);
    return colDef?.fields?.find(f => f.isPrimary)?.name || 'name';
}

/** Rejoins a half onto the value already in place, so undoing a max keeps the current. */
function joinValue(live, row) {
    const { current, max } = splitValue(live);

    if (row.kind === 'stat') return max ? `${row.after}/${max}` : String(row.after);
    if (!row.after || row.after === '(none)') return current;
    return `${current}/${row.after}`;
}

/**
 * Applies rows to a state object in place.
 *
 * Pure with respect to storage - nothing is saved, synced or emitted - because this only
 * ever builds a view of the past.
 */
export function applyRows(state, rows) {
    for (const row of rows) {
        if (row.kind === 'stat' || row.kind === 'stat-max') {
            if (row.scope === 'global') {
                state.global ||= {};
                state.global[row.label] = joinValue(state.global[row.label], row);
                continue;
            }
            const statActor = actorFor(state, row);
            if (!statActor) continue;
            statActor.stats ||= {};
            statActor.stats[row.label] = joinValue(statActor.stats[row.label], row);
            continue;
        }

        const actor = actorFor(state, row);
        if (!actor || !row.collectionId) continue;
        actor.collections ||= {};
        const items = actor.collections[row.collectionId] ||= [];
        const primary = primaryOf(row.collectionId);
        const keyOf = (item) => String(item?.[primary] ?? item?.name ?? '').toLowerCase();
        const wanted = row.item ? keyOf(row.item) : String(row.label).toLowerCase();
        const index = items.findIndex(i => keyOf(i) === wanted);

        if (row.kind === 'item-add' && index === -1 && row.item) items.push({ ...row.item });
        else if (row.kind === 'item-remove' && index !== -1) items.splice(index, 1);
        else if (row.kind === 'item-change' && index !== -1) items[index][row.field] = row.after;
    }
    return state;
}

/**
 * Reads a status block that was stripped out of a message back when the tracker wrote
 * one into the reply itself. Those blocks are still on disk in extra.sillynpc_status_raw,
 * and unlike a delta they are a real snapshot of that moment.
 */
function historicalStateFromBlock(message, fallback) {
    const raw = getPreservedStatusRaw(message);
    if (!raw) return null;
    try {
        /* `update`, singular, which is the key parseMessageForUpdates actually returns. This
           read `updates`, so it was always undefined and this function always returned null:
           the preserved-block path has never once run. Everything older than the
           applied-changes record was therefore reported as approximate, and the blocks
           status-history goes to the trouble of keeping on message.extra - specifically so
           history can be rebuilt from them - were never read. */
        const { update: updates } = parseMessageForUpdates(raw);
        if (!updates) return null;
        const state = structuredClone(fallback);
        // A block states values outright rather than as changes, so merge it over a copy.
        if (updates.global) Object.assign(state.global, updates.global);
        if (updates.player?.stats) Object.assign(state.player.stats, updates.player.stats);

        /* Characters too, which this used to leave out while still reporting the result as
           exact. The clone starts from the *latest* state, so a reconstruction showed
           historical globals, historical player stats and today's character stats, all
           labelled as known - a character's HP two hundred messages ago read as whatever it
           is now. Matched by name, and a character the block names who is not in the
           fallback is added rather than dropped: they were in the scene then. */
        for (const incoming of Array.isArray(updates.characters) ? updates.characters : []) {
            const name = String(incoming?.name ?? '').trim();
            if (!name) continue;
            let entry = (state.characters || []).find(
                c => String(c?.name ?? '').toLowerCase() === name.toLowerCase());
            if (!entry) {
                entry = { name, stats: {}, collections: {} };
                state.characters.push(entry);
            }
            if (incoming.stats) entry.stats = { ...entry.stats, ...incoming.stats };
        }
        return state;
    } catch (err) {
        debugLog('Could not read a preserved status block', err);
        return null;
    }
}

/**
 * Every message's state, from one walk backwards through the chat.
 *
 * Asking per message and walking to it each time is O(n squared): with the box shown
 * under all messages, a 321-message chat spent 538ms rebuilding the same history over
 * and over, on every re-render, and the tracker re-renders on every status update. One
 * pass produces all of them.
 *
 * @type {{ key: string, states: Map<number, {state: object, exact: boolean, reason: string}> } | null}
 */
let timeline = null;

/** Changes whenever a rebuild is needed: a different chat, a new message, a new state. */
function timelineKey(chat, current) {
    const context = getContext();
    const chatId = context?.getCurrentChatId?.() ?? context?.chatId ?? '';
    return `${chatId}|${chat.length}|${current?.timestamp ?? 0}`;
}

/** Throws the cached timeline away. */
export function invalidateTimeline() {
    timeline = null;
}

function buildTimeline(chat, current) {
    const states = new Map();
    const last = chat.length - 1;

    let running = structuredClone(current);
    let exact = true;
    let reason = 'reconstructed';

    for (let i = last; i >= 0; i--) {
        // Only worth consulting a preserved block once the delta chain has broken: while
        // it is intact it is authoritative, and parsing 157 blocks of old status output
        // to confirm what we already know is the expensive way to learn nothing.
        if (!exact) {
            const preserved = historicalStateFromBlock(chat[i], current);
            if (preserved) {
                running = preserved;
                exact = true;
                reason = 'preserved-block';
            }
        }

        /* The world's fields, when this message wrote them down.
         *
         * Always, not only once the chain has broken - a snapshot is what the globals were,
         * and the walk's own arithmetic is a derivation of it. Correcting from the record
         * whenever there is one keeps the two from quietly disagreeing about a value the
         * change rows never mentioned, which is every global a rule or an edit moved
         * without going through an update.
         *
         * The globals only. The rest of the state has no snapshot and stays derived, so
         * `exact` is not touched here: it describes the whole state, and knowing the world
         * for certain says nothing about anybody's stats.
         */
        const storedGlobals = chat[i]?.extra?.[GLOBALS_KEY];
        if (storedGlobals && typeof storedGlobals === 'object') {
            running.global = { ...storedGlobals };
        }

        /* And everybody's stats, the same way and for the same reason.
         *
         * Replacing the stats of whoever the snapshot names, and adding an entry for
         * anyone the walk has lost - somebody who left the cast later is still in this
         * message and still needs their numbers.
         *
         * Never *removing* an entry the snapshot omits. The snapshot carries stats and
         * nothing else, so an entry it does not mention may still hold collections the
         * walk reconstructed, and dropping it to match would throw those away to gain
         * nothing.
         *
         * `exact` is untouched here, as with the globals: it describes the whole state,
         * and knowing everybody's numbers says nothing about what they were carrying.
         */
        const storedChars = chat[i]?.extra?.[CHARS_KEY];
        if (storedChars && typeof storedChars === 'object') {
            if (!Array.isArray(running.characters)) running.characters = [];
            for (const [name, stats] of Object.entries(storedChars)) {
                let entry = running.characters.find(
                    c => String(c?.name ?? '').toLowerCase() === name.toLowerCase());
                if (!entry) {
                    entry = { name, stats: {}, collections: {} };
                    running.characters.push(entry);
                }
                entry.stats = { ...stats };
            }
        }

        states.set(i, {
            state: structuredClone(running),
            exact,
            reason: i === last ? 'latest' : reason,
        });

        const rows = appliedChangesForCurrentSwipe(i);
        if (rows === null) {
            // Older than the record. Everything before this is an approximation, and is
            // reported as one rather than presented as fact.
            exact = false;
            reason = 'no record before this point';
            continue;
        }
        applyRows(running, rows.map(invert));
    }

    return states;
}

/**
 * What the player looked like after each message, newest first.
 *
 * For choosing a point to go back to. Only messages where the player's stats actually
 * differ from the message after them are listed, since a hundred entries reading the same
 * is not a choice.
 *
 * @param {number} [limit] How many distinct points to return.
 * @returns {{ messageId: number, exact: boolean, stats: object, itemCount: number }[]}
 */
export function playerHistory(limit = 40) {
    const chat = getContext()?.chat || [];
    const points = [];
    let lastSeen = null;

    for (let i = chat.length - 1; i >= 0 && points.length < limit; i--) {
        const past = stateAtMessage(i);
        const player = past?.state?.player;
        if (!player) continue;

        const signature = JSON.stringify([player.stats, player.collections]);
        if (signature === lastSeen) continue;
        lastSeen = signature;

        points.push({
            messageId: i,
            exact: past.exact,
            stats: structuredClone(player.stats || {}),
            itemCount: Object.values(player.collections || {})
                .reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0),
        });
    }
    return points;
}

/**
 * Puts the player's stats and collections back to what they were after a message.
 *
 * The recovery that already existed and had no way in. When a story's HP and Energy were
 * overwritten, the per-message records were the only surviving copy and reading them was
 * a manual dig through the chat file; the ten-slot persona ring that was supposed to be
 * the safety net held nothing, because it only recorded when an item count dropped.
 *
 * The player half only. The NPCs and the world have carried on since, and were not what
 * was lost - rolling those back would trade one kind of damage for another. It lands as
 * an ordinary undo step, so getting the wrong message is itself reversible.
 *
 * @param {string|number} messageId
 * @returns {{ exact: boolean, reason: string }|null} Null when there is nothing to restore.
 */
export function restorePlayerFromMessage(messageId) {
    const past = stateAtMessage(messageId);
    if (!past?.state?.player) return null;

    const current = loadStateFromMetadata();
    if (!current?.player) return null;

    // Built as a copy rather than edited in place. The undo step records whatever is in
    // metadata at save time, and the live state *is* that object - changing it first would
    // file the new values as the thing to go back to, quietly making this the one action
    // that cannot be undone.
    const state = structuredClone(current);
    state.player.stats = structuredClone(past.state.player.stats || {});
    state.player.collections = structuredClone(past.state.player.collections || {});

    saveStateToMetadata(state, { label: `Player restored from message ${messageId}` });
    // Authoritative: this is a decision, so the seed for future chats follows it rather
    // than merging what was just deliberately rolled back.
    syncPlayerToMaster(state, { authoritative: true });
    eventSource.emit('sillynpc-status-updated', state);

    debugLog(`Player state restored from message ${messageId}`, past);
    return { exact: past.exact, reason: past.reason };
}

/**
 * The state as it stood after the given message.
 *
 * @param {string|number} messageId
 * @returns {{ state: object, exact: boolean, reason: string }}
 */
export function stateAtMessage(messageId) {
    const current = loadStateFromMetadata();
    const index = Number(messageId);
    const chat = getContext()?.chat || [];

    if (!Number.isInteger(index) || index >= chat.length - 1 || chat.length === 0) {
        return { state: current, exact: true, reason: 'latest' };
    }

    const key = timelineKey(chat, current);
    if (!timeline || timeline.key !== key) {
        timeline = { key, states: buildTimeline(chat, current) };
    }

    const found = timeline.states.get(index) ?? { state: current, exact: false, reason: 'not in this chat' };
    return withMessageEdits(found, chat[index]);
}

