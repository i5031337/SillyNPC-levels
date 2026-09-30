import { getContext } from '../../../../../../st-context.js';
import { loadStateFromMetadata, recordTurnEffects } from '../status-logic.js';

/** Compact reply records used to keep the current tracker state in step with swipes. */

/** Where a message's applied changes are recorded. */
export const APPLIED_KEY = 'sillynpc_applied';
/**
 * Which reply those changes describe.
 *
 * A message can hold several replies and shows one at a time. SillyTavern keeps the rest in
 * swipe_info and swaps `extra` when you move between them, so the record travels with its
 * reply - except in one place. Over-swiping past the last reply runs clearMessageData, which
 * deletes ten named keys and not this one, and never calls syncSwipeToMes, so the message
 * carries the outgoing reply's record into a reply that has not been written yet.
 *
 * Rebuilding from the base and replaying that record then counts the new reply from the old
 * one: lose 20, swipe, lose 10, and the tracker says 70 instead of 90. Stamping the record
 * with the reply it belongs to is what lets a reader tell it is looking at the wrong one.
 */
export const APPLIED_SWIPE_KEY = 'sillynpc_applied_swipe';

/**
 * World fields at this message, used by optional history notes.
 */
export const GLOBALS_KEY = 'sillynpc_globals';


function messageAt(messageId) {
    return getContext()?.chat?.[Number(messageId)] ?? null;
}

/**
 * Saving the chat is not cheap - the whole file is serialised and posted, and a long
 * chat is well over a megabyte. Writing it once per record, on top of the write the
 * review already asks for and SillyTavern's own, meant several full writes per message.
 *
 * These records are a convenience, so a short delay costs nothing if the page goes away
 * first; the flush on unload means it usually does not.
 */
const SAVE_DELAY_MS = 1500;
let saveTimer = null;

export function saveChatSoon() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        getContext()?.saveChat?.();
    }, SAVE_DELAY_MS);
}

/** Writes immediately if a save is pending. */
function flushPendingSave() {
    if (!saveTimer) return false;
    clearTimeout(saveTimer);
    saveTimer = null;
    getContext()?.saveChat?.();
    return true;
}

// A pending record must not be lost to a reload or a chat switch.
if (typeof window?.addEventListener === 'function') {
    window.addEventListener('beforeunload', flushPendingSave);
}

/**
 * Keeps only what an undo needs. The full row also carries a reason string and, for
 * stat rows, a copy of the item, which are useful in the review panel and dead weight
 * in every message forever.
 */
function trimRow(row) {
    const out = {
        scope: row.scope, kind: row.kind, label: row.label,
        before: row.before, after: row.after,
    };
    if (row.actor) out.actor = row.actor;
    if (row.collectionId) out.collectionId = row.collectionId;
    if (row.field) out.field = row.field;
    // An item row has to carry the item itself, or putting it back is impossible.
    if (row.item && (row.kind === 'item-add' || row.kind === 'item-remove')) out.item = row.item;
    return out;
}

/**
 * Records what a message actually changed.
 *
 * Always writes, even when nothing changed: an absent property means the message
 * predates this feature and the chain cannot be walked through it, while an empty array
 * means the message genuinely changed nothing. Without that distinction a quiet message
 * is indistinguishable from a gap in the record.
 *
 * @param {string|number} messageId
 * @param {Array<object>} changes Rows that were applied, from computeStateDiff.
 */
export function recordAppliedChanges(messageId, changes) {
    const message = messageAt(messageId);
    if (!message) return false;
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};

    // The turn record supports latest-reply consistency.
    recordTurnEffects(messageId);

    const rows = (changes || []).map(trimRow);
    const existing = message.extra[APPLIED_KEY];
    // A reviewed change lands after the automatic part of the same message, so append
    // rather than replace, or the earlier half is forgotten.
    message.extra[APPLIED_KEY] = Array.isArray(existing) ? existing.concat(rows) : rows;

    /* And what the world looks like now that they have landed.
     *
     * Written after the changes rather than beside them because it is the state *at* this
     * message, not the state it started from. Overwritten rather than appended for the
     * reviewed half of the same message, which is right: the second write knows more.
     */
    const now = loadStateFromMetadata();
    message.extra[GLOBALS_KEY] = { ...(now?.global ?? {}) };
    // Which reply these describe. The appended half belongs to the same one, so writing it
    // again is right rather than merely harmless.
    message.extra[APPLIED_SWIPE_KEY] = currentSwipeOf(message);

    saveChatSoon();
    return true;
}

/** The reply a message is showing. Messages without swipes are all reply zero. */
function currentSwipeOf(message) {
    return Number(message?.swipe_id ?? 0);
}

/** The rows recorded for a message, or null when it has no record at all. */
export function getAppliedChanges(messageId) {
    const applied = messageAt(messageId)?.extra?.[APPLIED_KEY];
    return Array.isArray(applied) ? applied : null;
}

/**
 * The rows recorded for the reply a message is showing right now.
 *
 * Null where getAppliedChanges would return rows belonging to a different reply - which is
 * what a message carries for the moment between swiping past the last one and the new one
 * being read. See APPLIED_SWIPE_KEY.
 *
 * A record with no stamp is returned as it stands. Those were written before rows carried
 * one, and reading them as stale would change how every existing chat rebuilds, under
 * people who did not ask for that; they are corrected the next time the message is read.
 *
 * @param {string|number} messageId
 * @returns {Array<object>|null}
 */
export function appliedChangesForCurrentSwipe(messageId) {
    const rows = getAppliedChanges(messageId);
    if (rows === null) return null;

    const message = messageAt(messageId);
    const recorded = message?.extra?.[APPLIED_SWIPE_KEY];
    if (typeof recorded !== 'number') return rows;

    return recorded === currentSwipeOf(message) ? rows : null;
}

/** Drops records for a reply whose text was edited before reading it again. */
export function clearTurnRecord(messageId) {
    const extra = messageAt(messageId)?.extra;
    if (!extra) return false;
    for (const key of [APPLIED_KEY, APPLIED_SWIPE_KEY, GLOBALS_KEY,
        'sillynpc_chars', 'sillynpc_turn_effects']) delete extra[key];
    saveChatSoon();
    return true;
}
