import { getContext } from '../../../../../../st-context.js';
import { getSettings } from '../../core/settings.js';
import { getAllCharacters } from '../../characters/character-repository.js';
import { getCurrentPersonaKey } from '../status-logic.js';
import { getPendingChanges, setPendingChanges, getLooseNotes, getRefusedValues } from '../status-review.js';
import { appliedChangesForCurrentSwipe, saveChatSoon } from '../snapshots/status-snapshot-records.js';
import { selectLevelGrants, collectLevelTransitions } from './status-level-grants.js';

export const LEVEL_READING_KEY = 'sillynpc_level_reading';
const retrying = new WeakSet();

/** Keep validated choices with this reading; retries never read or award XP again. */
export async function prepareLevelReading(parsed, state, tracker, text, leadUp, message, messageId, { regenerate = false } = {}) {
    const swipe = Number(message?.swipe_id ?? 0);
    const previous = !regenerate && message?.extra?.[LEVEL_READING_KEY];
    const personaId = getCurrentPersonaKey();
    const reading = previous?.swipe === swipe && previous.sourceText === message?.mes && previous.personaId === personaId
        ? structuredClone(previous) : { swipe, sourceText: message?.mes, personaId, parsed: structuredClone(parsed),
            state: structuredClone(state), text, leadUp, cache: {}, decidedGrantIds: [] };
    const rejected = new Set(reading.rejectedTransitionIds || []);
    const skipped = (reading.failures || []).filter(failure =>
        [...rejected].some(id => failure.id.startsWith(`${id}:`))).map(failure => failure.id);
    const context = { messageId, swipeId: swipe, personaId, cards: getAllCharacters(),
        cache: reading.cache, allowNewPointBudgets: !previous,
        decidedGrantIds: [...(reading.decidedGrantIds || []), ...skipped] };
    const grants = await selectLevelGrants(reading.parsed, reading.state, tracker, text, leadUp, context);
    grants.rows = grants.rows.filter(row => !rejected.has(row.grant.transitionId));
    grants.failures = grants.failures.filter(failure => ![...rejected].some(id => failure.id.startsWith(`${id}:`)));
    reading.cache = grants.cache;
    reading.failures = grants.failures;
    reading.rows = grants.rows;
    return { ...grants, reading, transitions: collectLevelTransitions(reading.parsed, reading.state, tracker, context) };
}

export function saveLevelReading(message, reading) {
    message.extra ||= {};
    message.extra[LEVEL_READING_KEY] = reading;
    saveChatSoon();
}

export async function retryLevelReading(messageId) {
    if (!getSettings().enabled) return { applied: false, reason: 'extension disabled' };
    const context = getContext();
    const message = context?.chat?.[Number(messageId)];
    const reading = message?.extra?.[LEVEL_READING_KEY];
    if (!reading?.failures?.length || reading.swipe !== Number(message.swipe_id ?? 0)
        || reading.sourceText !== message.mes || reading.personaId !== getCurrentPersonaKey()) return { applied: false, reason: 'stale reward reading' };
    if (retrying.has(message)) return { applied: false, reason: 'reward retry already running' };
    retrying.add(message);
    try {
        const grants = await prepareLevelReading(reading.parsed, reading.state, getSettings().statusTracker,
            reading.text, reading.leadUp, message, messageId);
        if (!getSettings().enabled) return { applied: false, reason: 'extension disabled' };
        if (getContext()?.chatMetadata !== context.chatMetadata || getContext()?.chat?.[Number(messageId)] !== message
            || reading.swipe !== Number(message.swipe_id ?? 0) || reading.sourceText !== message.mes
            || reading.personaId !== getCurrentPersonaKey()) return { applied: false, reason: 'reply changed while selecting rewards' };
        const pending = getPendingChanges(messageId);
        const known = new Set([...pending, ...(appliedChangesForCurrentSwipe(messageId) || [])].map(row => row.grant?.id).filter(Boolean));
        const latest = message.extra[LEVEL_READING_KEY];
        const decided = new Set(latest.decidedGrantIds || []);
        const rejected = new Set(latest.rejectedTransitionIds || []);
        const additions = grants.rows.filter(row => !known.has(row.grant.id) && !decided.has(row.grant.id)
            && !rejected.has(row.grant.transitionId));
        grants.reading.decidedGrantIds = [...decided];
        grants.reading.rejectedTransitionIds = [...rejected];
        grants.reading.failures = grants.failures.filter(failure => ![...rejected].some(id => failure.id.startsWith(`${id}:`)));
        saveLevelReading(message, grants.reading);
        setPendingChanges(messageId, pending.concat(additions), getLooseNotes(messageId), getRefusedValues(messageId));
        return { applied: true, pending: additions.length, failures: grants.reading.failures.length };
    } finally { retrying.delete(message); }
}
