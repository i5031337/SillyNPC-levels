import { getContext } from '../../../../st-context.js';
import { saveChatSoon } from './status-snapshot-records.js';

/**
 * Where a value typed into an older message's tracker is kept: on that message, and read
 * back for that message only.
 *
 * Editing a box under an old message used to change the *live* state, so going back to the
 * message showed its old value again - the edit looked lost - and today's value changed
 * instead. A correction to what the record says at message 10 is a fact about message 10:
 * it changes nothing later and nothing now. Kept on the message itself, it travels with the
 * chat file like the rest of the record.
 *
 * `{ global: { key: value }, player: { key: value }, characters: { name: { key: value } } }`
 */
export const EDITS_KEY = 'sillynpc_edits';

/**
 * Records a value typed into an older message's tracker, for that message only.
 *
 * @param {number} messageId
 * @param {{ type: 'global'|'player'|'character', key: string, value: string, name?: string }} edit
 * @returns {boolean} Whether it was recorded.
 */
export function recordMessageEdit(messageId, { type, key, value, name = '' }) {
    const message = getContext()?.chat?.[Number(messageId)];
    if (!message || !key) return false;
    if (!message.extra) message.extra = {};
    const edits = message.extra[EDITS_KEY] && typeof message.extra[EDITS_KEY] === 'object'
        ? message.extra[EDITS_KEY] : {};
    if (type === 'global') {
        edits.global = { ...(edits.global || {}), [key]: value };
    } else if (type === 'player') {
        edits.player = { ...(edits.player || {}), [key]: value };
    } else if (type === 'character' && name) {
        edits.characters = { ...(edits.characters || {}) };
        edits.characters[name] = { ...(edits.characters[name] || {}), [key]: value };
    } else {
        return false;
    }
    message.extra[EDITS_KEY] = edits;
    saveChatSoon();
    return true;
}

/** The key a stats object already has for a name, whatever its case - or the name itself. */
function keyIn(stats, name) {
    const wanted = String(name).toLowerCase();
    return Object.keys(stats || {}).find(k => k.toLowerCase() === wanted) ?? name;
}

/**
 * A message's reconstructed state with the corrections typed into its own tracker laid over
 * it. A copy, so the timeline's shared state is never written into.
 */
export function withMessageEdits(found, message) {
    const edits = message?.extra?.[EDITS_KEY];
    if (!edits || typeof edits !== 'object' || !found?.state) return found;
    const state = structuredClone(found.state);
    for (const [key, value] of Object.entries(edits.global || {})) {
        if (!state.global) state.global = {};
        state.global[keyIn(state.global, key)] = value;
    }
    for (const [key, value] of Object.entries(edits.player || {})) {
        if (!state.player) state.player = { stats: {} };
        if (!state.player.stats) state.player.stats = {};
        state.player.stats[keyIn(state.player.stats, key)] = value;
    }
    for (const [name, stats] of Object.entries(edits.characters || {})) {
        const who = (state.characters || []).find(c => String(c?.name).toLowerCase() === name.toLowerCase());
        if (!who) continue;
        if (!who.stats) who.stats = {};
        for (const [key, value] of Object.entries(stats || {})) who.stats[keyIn(who.stats, key)] = value;
    }
    return { ...found, state };
}

