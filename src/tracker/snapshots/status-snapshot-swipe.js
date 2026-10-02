import { debugLog } from '../../core/constants.js';
import { getContext } from '../../../../../../st-context.js';
import { loadStateFromMetadata, saveStateToMetadata, getSwipeBase, swipeBaseRecord, getProfileBase, restoreProfiles, snapshotProfiles } from '../status-logic.js';
import { getAppliedChanges, appliedChangesForCurrentSwipe } from './status-snapshot-records.js';
import { applyRows } from './status-row-replay.js';
import { diffTurnValues, applyTurnValues, turnEffectStatus } from './status-turn-delta.js';
import { syncRebasedLore } from './status-rebase-lore.js';

/** Preview a replacement reading without changing live state while its request runs. */
export function replacementReadingState(messageId) {
    const record = swipeBaseRecord();
    if (!record || record.messageId !== String(messageId)) return null;
    if (!record.applied) return getSwipeBase(messageId);
    return applyTurnValues(structuredClone(record.state),
        diffTurnValues(record.applied.state, loadStateFromMetadata()));
}

/** Rebuilds the chosen reply and carries corrections made after the outgoing one. */
function rebaseRecordedTurn(messageId, { removed = false } = {}) {
    const record = swipeBaseRecord();
    if (!record || record.messageId !== String(messageId) || !record.applied) return null;
    const current = loadStateFromMetadata();
    const profilesNow = snapshotProfiles();
    const manualState = diffTurnValues(record.applied.state, current);
    const manualProfiles = diffTurnValues(record.applied.profiles, profilesNow);
    const message = getContext()?.chat?.[Number(messageId)];
    const effects = removed ? null : message?.extra?.sillynpc_turn_effects;
    const effectStatus = turnEffectStatus(effects, message);
    if (effectStatus === 'mismatch') return { rebased: false, reason: 'reply changed' };
    const valid = effectStatus === 'valid';

    let replyState = structuredClone(record.state);
    let replyProfiles = structuredClone(record.profiles);
    if (valid) {
        replyState = applyTurnValues(replyState, effects.state);
        replyProfiles = applyTurnValues(replyProfiles, effects.profiles);
    } else if (!removed) {
        // Saved replies written before turn effects still have stat/item rows.
        applyRows(replyState, appliedChangesForCurrentSwipe(messageId) || []);
    }
    const state = applyTurnValues(replyState, manualState);
    const profiles = applyTurnValues(replyProfiles, manualProfiles);
    const changedProfiles = restoreProfiles(profiles);
    saveStateToMetadata(state, { recordHistory: false });
    syncRebasedLore(current, state, changedProfiles);
    record.applied = { state: replyState, profiles: replyProfiles };
    return removed
        ? { reverted: true, reason: 'back to the base' }
        : { rebased: true, reason: valid ? 'restored' : 'back to the base' };
}

/**
 * Puts the tracker back in step with the swipe now on screen.
 *
 * Swiping replaces the newest reply. The changes already applied describe the reply that
 * was there before, so the state is rebuilt from what it was before that message and the
 * chosen swipe's own record is applied to it. Nothing is inverted: by the time
 * MESSAGE_SWIPED fires SillyTavern has already swapped `extra` to the incoming swipe, so
 * the outgoing swipe's rows are no longer readable - and rebuilding from a known base is
 * both simpler and exact.
 *
 * A swipe with no record of its own leaves the state at the base. That is the right answer
 * for a swipe about to be generated: the extraction that follows applies to the base
 * rather than stacking on the swipe you left.
 *
 * @param {string|number} messageId
 * @returns {{ rebased: boolean, reason: string }}
 */
/**
 * Keeps the swipe base in step with corrections nobody's message made.
 *
 * The base is the state before a message was read, and rebaseToSwipe rebuilds from it. So
 * anything changed between reading that message and swiping it - a stat corrected on the
 * player sheet, an item added by hand - is in neither the base nor the message's rows, and
 * the rebuild has nowhere to put it. It came back as "I edit a value and the moment I
 * swipe, it goes back to what it was".
 *
 * The rule needs no diff and no undo, which is what makes it safe: **whatever this message
 * did not touch, the base should agree with now.** The message's rows say exactly what it
 * touched, so those values stay as the base recorded them - a swipe still undoes the reply
 * - and everything else is brought up to date.
 *
 * That also survives an editor that mutates the live state in place, which several of them
 * do. Comparing before and after would have seen nothing there, because before and after
 * are the same object.
 *
 * @returns {number} How many values were brought up to date.
 */
export function alignSwipeBaseToNow() {
    const record = swipeBaseRecord();
    if (!record?.state) return 0;
    // New turn records track corrections as the difference from the applied reply.
    if (record.applied) return 0;

    const base = record.state;
    const now = loadStateFromMetadata();
    if (!now) return 0;

    /* Two questions, and they have different answers.

       Is there a record at all? An absent one means the message predates this feature, or
       Record What Each Message Changed is off - and then there is no way to tell what the
       reply did from what somebody corrected afterwards. Aligning on that guess would fold
       the reply's own changes into the base and stop the swipe undoing anything, which is a
       far worse bug than the one this fixes. So: refuse.

       And what did the reply now on screen do? A record stamped for another reply answers
       that with nothing, and nothing is the truth: a rebase has just put the state back to
       the base, so the on-screen reply has changed nothing yet and everything that differs
       from the base is a correction. An empty array is the same answer for a message that
       genuinely changed nothing. */
    if (getAppliedChanges(record.messageId) === null) return 0;
    const rows = appliedChangesForCurrentSwipe(record.messageId) ?? [];

    // What the message changed, and therefore what the base must go on saying.
    const touched = new Set();
    for (const row of rows) {
        const who = `${row.scope}|${String(row.actor ?? '').toLowerCase()}`;
        touched.add(row.collectionId
            ? `${who}|col|${row.collectionId}`
            : `${who}|stat|${row.label}`);
    }

    let moved = 0;

    const alignStats = (who, from, to) => {
        const source = from || {};
        for (const [name, value] of Object.entries(source)) {
            if (touched.has(`${who}|stat|${name}`) || to[name] === value) continue;
            to[name] = value;
            moved += 1;
        }
        // A stat deleted by hand goes from the base too, or the swipe brings it back.
        for (const name of Object.keys(to)) {
            if (name in source || touched.has(`${who}|stat|${name}`)) continue;
            delete to[name];
            moved += 1;
        }
    };

    const alignCollections = (who, from, to) => {
        for (const [id, list] of Object.entries(from || {})) {
            if (touched.has(`${who}|col|${id}`)) continue;
            // Compared as text: these are small lists of plain objects, and the alternative
            // is a deep-equality helper that exists nowhere else in this file.
            if (JSON.stringify(to[id]) === JSON.stringify(list)) continue;
            to[id] = structuredClone(list);
            moved += 1;
        }
    };

    base.global ||= {};
    alignStats('global|', now.global, base.global);

    if (now.player) {
        base.player ||= { name: now.player.name, stats: {}, collections: {} };
        base.player.stats ||= {};
        base.player.collections ||= {};
        alignStats('player|', now.player.stats, base.player.stats);
        alignCollections('player|', now.player.collections, base.player.collections);
    }

    base.characters ||= [];
    for (const char of now.characters || []) {
        const key = String(char?.name ?? '').trim().toLowerCase();
        if (!key) continue;

        let target = base.characters.find(c => String(c?.name ?? '').toLowerCase() === key);
        if (!target) {
            /* Somebody the message introduced has rows of their own, and putting them in
               the base would mean a swipe could no longer remove them. Only somebody who
               arrived by hand belongs here. */
            const fromThisMessage = [...touched].some(k => k.startsWith(`character|${key}|`));
            if (fromThisMessage) continue;
            target = { name: char.name, stats: {}, collections: {} };
            base.characters.push(target);
            moved += 1;
        }
        target.stats ||= {};
        target.collections ||= {};
        alignStats(`character|${key}`, char.stats, target.stats);
        alignCollections(`character|${key}`, char.collections, target.collections);
    }

    if (moved) debugLog(`Swipe base kept in step with ${moved} change(s) made outside a reply`);
    return moved;
}

export function rebaseToSwipe(messageId) {
    const recorded = rebaseRecordedTurn(messageId);
    if (recorded) return recorded;
    const base = getSwipeBase(messageId);
    if (!base) {
        // Missing after a reload, or for a message written before this existed. Applying
        // the chosen swipe's changes on top of the state as it stands would double-count
        // the swipe already in it, which is the fault this exists to prevent.
        return { rebased: false, reason: 'no base' };
    }

    // Profiles first: they live on the card rather than in the state, so the clone below
    // cannot carry them and a rewritten personality would otherwise outlive the reply that
    // wrote it. Deliberately not part of applyRows - that also builds the read-only history
    // view, and writing to settings from there would rewrite every card on a scroll.
    const previous = loadStateFromMetadata();
    const changedProfiles = restoreProfiles(getProfileBase(messageId));

    const rows = appliedChangesForCurrentSwipe(messageId) || [];
    const state = structuredClone(base);
    applyRows(state, rows);

    saveStateToMetadata(state, { recordHistory: false });
    syncRebasedLore(previous, state, changedProfiles);
    debugLog(`Rebased onto swipe of message ${messageId}: ${rows.length} change(s)`);
    return { rebased: true, reason: rows.length ? 'restored' : 'back to the base' };
}

/**
 * Puts the tracker back to before a message that is about to stop existing.
 *
 * rebaseToSwipe's sibling, and the difference is that nothing is replayed. A swipe is a
 * message being *replaced*, so the incoming swipe's own record goes back on top; this is a
 * message being *removed*, so its rows die with it.
 *
 * Written for Regenerate, which is not a swipe: SillyTavern truncates the chat and emits
 * MESSAGE_DELETED, never MESSAGE_SWIPED, so nothing here used to run at all. The discarded
 * reply's stat changes stayed applied, the replacement was refused by the
 * extraction guard as already read, and the tracker held the wrong numbers from then on.
 *
 * The base is deliberately left in place. The replacement occupies the same index, so the
 * state remembered before the old one is exactly the right base for the new one, and
 * rememberSwipeBase declines to overwrite an entry that already names that message.
 *
 * @param {string|number} messageId
 * @returns {{ reverted: boolean, reason: string }}
 */
export function revertToBase(messageId) {
    const recorded = rebaseRecordedTurn(messageId, { removed: true });
    if (recorded) return recorded;
    const base = getSwipeBase(messageId);
    // Same refusal as rebaseToSwipe: without a known starting point the only alternative is
    // to invent one, and a wrong revert throws away state silently.
    if (!base) return { reverted: false, reason: 'no base' };

    const previous = loadStateFromMetadata();
    const changedProfiles = restoreProfiles(getProfileBase(messageId));
    saveStateToMetadata(base, { recordHistory: false });
    syncRebasedLore(previous, base, changedProfiles);
    debugLog(`Reverted to the state before message ${messageId}`);
    return { reverted: true, reason: 'back to the base' };
}
