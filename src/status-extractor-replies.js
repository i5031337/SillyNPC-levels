import { promptText } from './prompt-texts.js';
import { getSettings, saveSettings } from './settings.js';
import { LOG_PREFIX, debugLog, fieldsForCard, aiMayEditProfileField, anyProfileFieldUnlocked } from './constants.js';
import { getPlayerCard, findCardForName, loadStateFromMetadata, saveStateToMetadata } from './status-logic.js';
import { currentMessageIndex, splitValue } from './utils.js';
import { progressXp, boostStat } from './progression.js';
import { profileOwners } from './status-extractor-schema.js';
import { requestExtraction, coerceToUpdate } from './status-extractor-request.js';
import { mentionsName } from './mentions.js';
import { coerceThread, addThread, closeThread, openThreads, touchThreads, pruneThreads } from './threads.js';
import { recordThreadChanges } from './status-snapshots.js';
import { syncProfileToLore } from './lore-sync.js';

/** Choose a story-appropriate sheet bonus once an XP award crosses its cap. */
export async function addLevelBonus(parsed, state, trackerSettings, messageText) {
    const stats = parsed?.player?.stats || parsed?.player;
    const current = state?.player?.stats || {};
    const xpName = Object.keys(current).find(key => key.toLowerCase() === 'xp');
    const levelName = Object.keys(current).find(key => key.toLowerCase() === 'level');
    const bonusName = (trackerSettings.playerStats || []).find(s => s.name.toLowerCase() === 'level bonus' && !s.locked)?.name;
    if (!stats || !xpName || !levelName || !bonusName) return;
    const xpKey = Object.keys(stats).find(key => key.toLowerCase() === 'xp');
    if (!xpKey) return;
    const transition = progressXp(current[xpName], stats[xpKey], current[levelName]);
    if (!transition || transition.levelsGained < 1) return;

    const eligible = (trackerSettings.playerStats || []).filter(def => {
        if (def.locked || ['xp', 'level', 'level bonus'].includes(def.name.toLowerCase())) return false;
        const parts = splitValue(current[def.name]);
        return Number.isFinite(Number(parts.current)) && parts.current !== '';
    }).map(def => def.name);
    const prompt = promptText('levelBonus', {
        level: transition.level,
        message: messageText,
        sheet: JSON.stringify(current),
        eligible: eligible.join(', ') || '(none)',
    });
    const schema = {
        type: 'object', required: ['description'],
        properties: {
            description: { type: 'string' },
            stat: { type: 'string' },
            amount: { type: 'number' },
        },
    };
    let bonus;
    try {
        bonus = coerceToUpdate(await requestExtraction(prompt, schema, trackerSettings,
            promptText('levelBonusSystem'),
            { usageKind: 'extraction' }));
    } catch (error) {
        console.warn(LOG_PREFIX, 'Level-up bonus request failed:', error);
    }
    const description = String(bonus?.description ?? '').trim().slice(0, 180);
    if (!description) return;
    const amount = Number(bonus?.amount);
    const target = eligible.find(name => name.toLowerCase() === String(bonus?.stat ?? '').toLowerCase());
    const sheetStats = parsed.player.stats || parsed.player;
    if (target && Number.isInteger(amount) && amount >= 1 && amount <= 5) {
        const boosted = boostStat(current[target], sheetStats[target], amount);
        if (boosted !== null) sheetStats[target] = boosted;
    }
    sheetStats[bonusName] = `Level ${transition.level}: ${description}`;
}

export function applyProfileFromReply(parsed) {
    if (!anyProfileFieldUnlocked(profileOwners())) return [];

    const changed = [];
    const touched = new Set();

    const write = (card, incoming) => {
        if (!card || !incoming || typeof incoming !== 'object') return;
        if (!card.profile || typeof card.profile !== 'object') card.profile = {};

        for (const field of fieldsForCard(card)) {
            if (!aiMayEditProfileField(card, field.id)) continue;
            const value = String(incoming[field.id] ?? '').trim();
            // An omitted field means "unchanged", and a blank one is the model failing to
            // answer rather than deciding somebody has no personality.
            if (!value || value === String(card.profile[field.id] ?? '').trim()) continue;
            card.profile[field.id] = value;
            changed.push(`${card.name}.${field.label}`);
            touched.add(card);
        }
    };

    if (parsed?.player?.profile) {
        try { write(getPlayerCard(), parsed.player.profile); } catch { /* no persona */ }
    }

    for (const incoming of Array.isArray(parsed?.characters) ? parsed.characters : []) {
        if (incoming?.profile) write(findCardForName(incoming.name), incoming.profile);
    }

    if (changed.length) {
        saveSettings();
        for (const card of touched) syncProfileToLore(card).catch(err =>
            console.error(LOG_PREFIX, 'Could not update profile in lorebook', err));
        debugLog('Profile fields the story changed:', changed);
    }
    return changed;
}

/**
 * Opens and closes threads from what the reader returned.
 *
 * Saved in its own step rather than through applyUpdate, and returns what it did so a
 * caller reading a whole history can report totals.
 *
 * @param {object} parsed The reply.
 * @param {string|number|null} messageId Which message opened them.
 * @param {string} [messageText] The message itself, used only to decide whether the player
 *   was named in it. The history scan does not pass one, and does not need to.
 * @returns {{ opened: number, closed: number }}
 */
export function applyThreadsFromReply(parsed, messageId = null, messageText = '') {
    const trackerSettings = getSettings().statusTracker;
    if (trackerSettings.threadsEnabled !== true) return { opened: 0, closed: 0 };

    const proposed = Array.isArray(parsed?.threads) ? parsed.threads : [];
    const resolved = Array.isArray(parsed?.closed) ? parsed.closed : [];
    const state = loadStateFromMetadata();
    const present = (Array.isArray(parsed?.characters) ? parsed.characters : [])
        .map(c => c?.name)
        .filter(Boolean);

    /* The player, who is never in `characters` - they are reported under `player` - and so
       could never touch a thread about themselves. In a real chat most threads are about
       the player, and those were the ones ageing fastest.

       Only when the reply actually names them, rather than always. They are in every scene
       by definition, so counting them unconditionally would mean their threads never
       decayed at all and simply held the cap by weight. Naming is the honest signal: a
       reply that says "Kristof, you're the one holding the line" is engaging with them,
       and one that never mentions them is not. Second-person narration means this is
       often false, which is the point. */
    const playerName = String(state?.player?.name || '').trim();
    if (playerName && mentionsName(messageText, playerName)) present.push(playerName);

    // No early return on "nothing proposed" any more. Most messages open and close
    // nothing, and those are exactly the messages that say a thread is still live: whoever
    // it is about was in the scene. Leaving before touching them was what let a running
    // obligation age as though the story had dropped it.
    if (!proposed.length && !resolved.length && !present.length) return { opened: 0, closed: 0 };

    const now = currentMessageIndex();
    let opened = 0;
    let closed = 0;
    const touched = touchThreads(state, present, messageId ?? now);

    // Kept so the message can be told what it did: rebaseToSwipe rebuilds a swipe from
    // what was recorded against it, and a thread recorded nowhere is a thread that swipe
    // loses on the way back.
    const openedThreads = [];
    const closedIds = [];

    for (const raw of proposed) {
        const thread = coerceThread(raw, { messageId });
        // Refused rather than repaired. A thread with no quotable source is a thread
        // nobody opened, and the whole value of these is that the line can be checked.
        if (!thread) continue;
        if (addThread(state, thread)) {
            openedThreads.push(thread);
            opened += 1;
        }
    }

    for (const quote of resolved) {
        const key = String(quote ?? '').trim().toLowerCase();
        if (!key) continue;
        const match = openThreads(state)
            .find(t => String(t.quote).toLowerCase().includes(key)
                || key.includes(String(t.quote).toLowerCase()));
        if (match && closeThread(state, match.id)) {
            closedIds.push(match.id);
            closed += 1;
        }
    }

    // Only ever grew before. Every open thread also went into the next extraction prompt
    // as "already open, do not list again", so a chat that had collected eighty of them
    // was paying for eighty lines on every message while only the injected handful ever
    // reached the story.
    const pruned = pruneThreads(state, now);

    if (opened || closed || touched || pruned.open || pruned.closed) {
        saveStateToMetadata(state, { label: 'Threads', recordHistory: false });
        // Only when there is a message to record against. The catch-up scan passes none:
        // it reads the whole story rather than one reply, so there is no swipe to return
        // to and nothing for a rebuild to put back.
        //
        // Only what this message did, too - a thread dropped by the cap was not closed by
        // the reply, so a swipe back has nothing to undo about it.
        if ((opened || closed) && messageId !== null && messageId !== undefined) {
            recordThreadChanges(messageId, { opened: openedThreads, closed: closedIds });
        }
        debugLog(`Threads: opened ${opened}, closed ${closed}, touched ${touched}, `
            + `pruned ${pruned.open} open and ${pruned.closed} settled`);
    }
    return { opened, closed, touched, pruned };
}

/**
 * Brings an already-open chat within the caps.
 *
 * The caps arrived after the flooding did, so the chats that need them most are the ones
 * that already have eighty threads in them and would otherwise carry that until their next
 * extraction. Runs on chat load.
 *
 * It says what it removed rather than doing it quietly. Deleting sixty entries without a
 * word would look like the feature had lost them, and the number is the thing that makes
 * it read as tidying instead.
 *
 * @returns {{ open: number, closed: number }}
 */
export function tidyThreadsOnLoad() {
    const trackerSettings = getSettings().statusTracker;
    if (trackerSettings.threadsEnabled !== true) return { open: 0, closed: 0 };

    const state = loadStateFromMetadata();
    if (!Array.isArray(state?.threads) || !state.threads.length) return { open: 0, closed: 0 };

    const pruned = pruneThreads(state, currentMessageIndex());
    if (!pruned.open && !pruned.closed) return pruned;

    saveStateToMetadata(state, { label: 'Threads', recordHistory: false });

    const parts = [];
    if (pruned.open) parts.push(`${pruned.open} stale`);
    if (pruned.closed) parts.push(`${pruned.closed} settled`);
    toastr.info(`Tidied ${parts.join(' and ')} thread${pruned.open + pruned.closed === 1 ? '' : 's'}. `
        + 'Pin one to keep it for good.', 'SillyNPC');
    debugLog(`Threads tidied on load: ${pruned.open} open, ${pruned.closed} settled`);
    return pruned;
}
