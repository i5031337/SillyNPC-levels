import { getContext } from '../../../../../../st-context.js';
import { getSettings } from '../../core/settings.js';
import { loadStateFromMetadata } from '../status-logic.js';
import { invalidateTimeline } from './status-snapshot-timeline.js';

/**
 * What the tracker looked like when a given message was written.
 *
 * The status box has always drawn the *current* state, so turning it on under every
 * message repeated today's numbers all the way down the chat - a message from two
 * hundred turns ago claiming the HP the character has now. There was nothing else it
 * could do: no record of the past was ever kept.
 *
 * Rather than store a full state per message, this records what each message *changed* -
 * the same rows the review gate already computes - and reconstructs the past by walking
 * backwards from the present, undoing one message at a time. A delta is a few hundred
 * bytes where a state clone is tens of kilobytes.
 *
 * It lives on message.extra, which SillyTavern does not put in the prompt: only
 * extra.reasoning and extra.bias are ever read back. So this is a save, not context - it
 * costs nothing per message and the model never sees it.
 */

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
/** What a message opened or settled among the threads. See recordThreadChanges. */
export const THREADS_KEY = 'sillynpc_threads';

/**
 * The world's fields as they stood at this message.
 *
 * The change rows above say what *moved*, which is enough to walk backwards from today -
 * until the walk reaches a message older than the record, after which everything before it
 * is an approximation. That is fine for a tracker box, which says so, and not fine for
 * anything that has to act on the answer: a background chosen for message 45 from a guess
 * is wrong intermittently and only in old parts of a story, which is the hardest kind of
 * wrong to notice.
 *
 * So the globals are written down rather than only derived, and the walk uses them to
 * correct itself. They are small - a handful of short strings - and there is one per
 * message that changed anything.
 *
 * Like every other key here it lives in `extra`, which SillyTavern carries with the
 * message and never puts in a prompt. Nothing in the prompt path reads it; it exists for
 * this extension and what builds on it.
 */
export const GLOBALS_KEY = 'sillynpc_globals';

/**
 * Everybody's stats as they stood at this message.
 *
 * The same argument as the globals above, for the other half of the state. The change
 * rows are enough to walk backwards until the walk reaches a gap, after which every
 * character's numbers are an approximation - fine for a tracker box that says so, and not
 * fine for anything that acts on the answer. A portrait chosen for message 45 from a guess
 * is the wrong face, intermittently, only in old parts of a story.
 *
 * Stats only, and by name. Collections stay derived: they are far larger, and knowing what
 * somebody was carrying is not what anything reads this for.
 *
 * This one is not small - measured at about 350 bytes for a two-character scene against
 * roughly 100 for the globals, so a long chat grows by a percent or two per character on
 * stage. `recordMessageHistory: false` turns the whole record off for anyone who would
 * rather have the file back.
 *
 * Like every other key here it lives in `extra`, which SillyTavern carries with the
 * message and never puts in a prompt.
 */
export const CHARS_KEY = 'sillynpc_chars';

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
    if (getSettings().statusTracker?.recordMessageHistory === false) return false;

    const message = messageAt(messageId);
    if (!message) return false;
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};

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
    message.extra[CHARS_KEY] = Object.fromEntries(
        (now?.characters ?? [])
            .filter(c => c?.name)
            .map(c => [c.name, { ...(c.stats ?? {}) }]));
    // Which reply these describe. The appended half belongs to the same one, so writing it
    // again is right rather than merely harmless.
    message.extra[APPLIED_SWIPE_KEY] = currentSwipeOf(message);

    invalidateTimeline();
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

/**
 * What a message did to the threads, filed on the message itself.
 *
 * Everything else a message changes is already recorded here as rows, and rebaseToSwipe
 * rebuilds a swipe from the base plus those rows. Threads were not recorded anywhere per
 * message - they lived only in state.threads - so the rebuild's structuredClone dropped
 * them, and the extraction guard, keyed on message and swipe together, then refused to
 * read that swipe again. Swipe away and back and the promise was gone for good: the one
 * path where the numbers were safe and the threads were not.
 *
 * Both halves, not only the openings. A swipe that settled something has to settle it
 * again on the way back, or returning to it quietly reopens what it closed.
 *
 * @param {string|number} messageId
 * @param {{ opened?: object[], closed?: string[] }} changes
 */
export function recordThreadChanges(messageId, { opened = [], closed = [] } = {}) {
    if (!opened.length && !closed.length) return false;
    if (getSettings().statusTracker?.recordMessageHistory === false) return false;

    const message = messageAt(messageId);
    if (!message) return false;
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};

    const existing = message.extra[THREADS_KEY];
    // Appended for the same reason the rows are: one message can write threads more than
    // once, and replacing would forget the earlier half.
    message.extra[THREADS_KEY] = {
        opened: (existing?.opened || []).concat(opened),
        closed: (existing?.closed || []).concat(closed),
    };

    saveChatSoon();
    return true;
}

/** What a message did to the threads, or null when it did nothing. */
export function getThreadChanges(messageId) {
    const record = messageAt(messageId)?.extra?.[THREADS_KEY];
    if (!record || typeof record !== 'object') return null;
    return {
        opened: Array.isArray(record.opened) ? record.opened : [],
        closed: Array.isArray(record.closed) ? record.closed : [],
    };
}

