import { getContext } from '../../../../../../st-context.js';
import { getSettings } from '../../core/settings.js';
import { LOG_PREFIX, debugLog } from '../../core/constants.js';
import { loadStateFromMetadata, rememberSwipeBase, refreshTurnBase, sanitizeModelUpdate, reconcileScenePresence, applyUpdate, takeRefusedValues } from '../status-logic.js';
import { computeStateDiff, partitionChanges, buildUpdateFromChanges, attachReasons } from '../status-diff.js';
import { setPendingChanges, isItemDecided } from '../status-review.js';
import { recordAppliedChanges } from '../snapshots/status-snapshots.js';
import { applyTimeRules } from '../status-rules.js';
import { setStrangerKinds } from '../../characters/default-portraits.js';
import { triggerReprocess } from '../../chat/reprocess.js';
import { buildExtractionSchema, strangersToClassify } from './status-extractor-schema.js';
import { buildUserPrompt, collectLeadUp } from './status-extractor-prompt.js';
import { requestExtraction, coerceToUpdate } from './status-extractor-request.js';
import { expandNumericDeltas } from './status-extractor-deltas.js';
import { holdLevelBonusChanges } from '../stat-update-policy.js';
import { addLevelBonus, applyGoalsFromReply } from './status-extractor-replies.js';
import { startExtractionReport, finishExtractionReport, extractionSwipe } from './status-extraction-report.js';
import { renderExtractionReport } from '../ui/status-ui-report.js';

/** Guards against an extraction triggering the events that would start another. */
let activeExtraction = null;

/** Message ids already extracted, so a re-render does not re-run the request. */
const extractedMessages = new Set();

export function resetExtractionState() {
    activeExtraction = null;
    extractedMessages.clear();
}

/**
 * Forgets that messages from this index onward were ever read.
 *
 * The guard is keyed `messageId:swipeId`, and message ids are positions rather than
 * identities - delete the newest message and the next one written takes its number back.
 * Regenerate does exactly that, and the replacement arrives at the same index on swipe 0,
 * so the key was already in the set and the new reply was refused with 'already extracted'
 * - the tracker kept the discarded reply's numbers and never looked at the one on screen.
 *
 * Always safe: an index past the end of the chat has nothing to re-read, so the only thing
 * a stale entry there can do is refuse whatever occupies that position next.
 *
 * @param {string|number} index
 * @returns {number} How many were forgotten.
 */
export function forgetExtractionsFrom(index) {
    const from = Number(index);
    if (!Number.isFinite(from)) return 0;

    let forgotten = 0;
    for (const key of [...extractedMessages]) {
        if (Number(String(key).split(':')[0]) >= from && extractedMessages.delete(key)) {
            forgotten += 1;
        }
    }
    if (forgotten) debugLog(`Forgot ${forgotten} extraction(s) from message ${from} on`);
    return forgotten;
}
/**
 * Extracts state from one message and applies it.
 *
 * @param {string} messageText
 * @param {string|number} messageId
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ applied: boolean, reason?: string }>}
 */
/**
 * Tells the user an extraction failed, without becoming a nuisance.
 *
 * Only the two cases where the tracker wanted to change something and could not: a reply
 * that would not parse, and a request that threw. A reply that parsed and found nothing to
 * change is the ordinary case and says nothing, and neither do the guards that decline to
 * run at all.
 *
 * Repeats are swallowed. A model that returns unusable output does it on every message,
 * and a toast per message would bury the chat it is complaining about.
 *
 * @param {string} message
 */
let lastReportedProblem = '';
function reportExtractionProblem(message) {
    if (message === lastReportedProblem) return;
    lastReportedProblem = message;
    if (typeof toastr !== 'undefined') toastr.warning(message, 'SillyNPC');
}

export async function extractStateFromMessage(messageText, messageId, options = {}) {
    const trackerSettings = getSettings().statusTracker;
    if (!trackerSettings.enabled) return { applied: false, reason: 'tracker disabled' };
    if (!options.force && trackerSettings.extractionMode !== 'extract') {
        return { applied: false, reason: 'extraction disabled' };
    }
    if (!messageText || !String(messageText).trim()) return { applied: false, reason: 'empty message' };

    // Keyed on the swipe as well as the message. On the message alone, the first swipe
    // was read and every later one came back 'already extracted' and was never looked at
    // - so whichever reply you kept, the tracker held the numbers from swipe 1.
    const swipeId = getContext()?.chat?.[Number(messageId)]?.swipe_id ?? 0;
    const key = `${messageId}:${swipeId}`;
    if (!options.force && extractedMessages.has(key)) return { applied: false, reason: 'already extracted' };
    if (activeExtraction) return { applied: false, reason: 'already running' };

    const run = {};
    activeExtraction = run;
    const reportMessage = startExtractionReport(messageId);
    const swipe = extractionSwipe(reportMessage);
    let report = { swipe, status: 'failed', summary: 'The request did not complete', output: null };
    const refreshReport = () => {
        try {
            const mesEl = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
            if (mesEl) renderExtractionReport(mesEl, messageId);
        } catch (err) {
            console.warn(LOG_PREFIX, 'Could not draw the reader report.', err);
        }
    };
    refreshReport();
    try {
        const state = loadStateFromMetadata();
        // Before anything is applied. A later swipe of this message rebuilds from here
        // rather than from what this one leaves behind.
        rememberSwipeBase(messageId, state);
        const strangers = strangersToClassify(messageId);
        const schema = buildExtractionSchema(trackerSettings, { strangers, state });
        const leadUp = collectLeadUp(messageId, Number(trackerSettings.extractionContextMessages ?? 2));
        const userPrompt = buildUserPrompt(state, String(messageText), trackerSettings, leadUp, { strangers });

        debugLog('Extraction request for message', key);
        const raw = await requestExtraction(userPrompt, schema, trackerSettings);
        if (getContext()?.chat?.[Number(messageId)] !== reportMessage
            || extractionSwipe(reportMessage) !== swipe) {
            return { applied: false, reason: 'reply changed while reading' };
        }

        const parsed = coerceToUpdate(raw);
        if (!parsed || typeof parsed !== 'object') {
            report = { swipe, status: 'failed', summary: 'The reply could not be read', output: raw ?? null };
            console.warn(LOG_PREFIX, 'Extraction returned nothing usable; state left unchanged.', raw);
            // Said out loud, not just to the console. A reply that could not be read and a
            // message that genuinely changed nothing look identical from the outside, so
            // silence here reads as "the tracker is broken" rather than "this one failed".
            reportExtractionProblem(
                'The reader replied with something that could not be read, so nothing was '
                + 'changed. A smaller or faster model is the usual cause; expand the tracker '
                + 'reading under this reply to see the full output.',
            );
            return { applied: false, reason: 'unparseable' };
        }
        // Keep the reader's complete answer before sanitizing it or adding level bonuses.
        // Those steps change the object in place, and the original is what explains the
        // reader's decisions, including values the tracker later refuses.
        const readerOutput = structuredClone(parsed);
        const liveState = loadStateFromMetadata();
        expandNumericDeltas(parsed, liveState, trackerSettings);
        // No ceilings the stats do not have, and nothing for a locked stat. See
        // sanitizeModelUpdate.
        sanitizeModelUpdate(parsed, liveState, trackerSettings);
        const levelBonus = await addLevelBonus(parsed, liveState, trackerSettings,
            String(messageText), leadUp);
        if (getContext()?.chat?.[Number(messageId)] !== reportMessage
            || extractionSwipe(reportMessage) !== swipe) {
            return { applied: false, reason: 'reply changed while reading' };
        }

        refreshTurnBase(messageId);
        // Presence first: applyUpdate refuses to introduce characters in speakers mode,
        // so anyone the extraction reports must be admitted to the scene before their
        // stats can land.
        if (Array.isArray(parsed.characters)) {
            const names = parsed.characters.map(c => c?.name).filter(Boolean);
            // The prompt asks for everyone present, not just whoever changed, so this
            // list is complete and absence means departure.
            reconcileScenePresence(names, messageId, { authoritative: true });
        }

        /* Strangers' kinds, recorded for everyone asked about - an answer that is missing or
           not one of the tags counts as none fitting, so nobody waits for good. The chat is
           redrawn so they get their face now rather than at the next redraw. */
        if (strangers.length && setStrangerKinds(parsed.strangers, strangers)) {
            debugLog('Strangers\' kinds', parsed.strangers);
            triggerReprocess();
        }

        // Propose, then decide. A dry run says what the update would do, so additions,
        // removals and implausible jumps can be held back for a look rather than
        // becoming fact.
        const currentState = loadStateFromMetadata();
        /* Anything refused before this run belongs to an older one; the dry run below sees
           this whole reply, so what it turns down is this message's. */
        takeRefusedValues();
        const wouldBe = applyUpdate(parsed, { dryRun: true });
        const refused = takeRefusedValues().map(({ field, wanted, allowed, kept }) =>
            `${field}: "${wanted}" is not one of ${allowed.join(', ')} - kept "${kept}"`);
        if (refused.length) debugLog('Values refused by their allowed lists', refused);
        const proposed = computeStateDiff(currentState, wouldBe, trackerSettings);
        // Standing decisions are applied before the split, not after. Filtering only the
        // pending half would let a protected item be deleted outright by anyone whose
        // "Ask Before Applying" is set loosely enough for removals to apply on their own.
        const changes = proposed.filter(change => !isItemDecided(change));
        const blocked = proposed.length - changes.length;

        // The reader's own account of what it did, put on the rows it explains. Never part
        // of the state: applyUpdate reads only the keys it knows, so "why" is inert there,
        // and it is read here instead.
        const unmatched = attachReasons(changes, parsed.why);
        if (parsed.why && Object.keys(parsed.why).length) {
            debugLog('Why the reader changed things', parsed.why);
        }

        const { auto, pending } = partitionChanges(changes, trackerSettings);
        holdLevelBonusChanges(auto, pending, levelBonus);

        // The parsed update is only safe to apply whole when nothing was held back. If a
        // row was blocked by a standing decision, applying `parsed` would carry out the
        // very change that was blocked, so the surviving rows are rebuilt instead.
        if (pending.length === 0 && blocked === 0) {
            applyUpdate(parsed, { partOfMessage: true });
        } else if (auto.length > 0) {
            // Apply the uncontroversial part now so the tracker stays current while the
            // rest waits.
            applyUpdate(buildUpdateFromChanges(auto, currentState, trackerSettings),
                { partOfMessage: true });
        }

        // Now that the message's own update has landed, the clock has moved - so what
        // elapsed time implies can be worked out. This is arithmetic on a timestamp the
        // narrator wrote, not a reading of the prose, so it applies rather than being
        // proposed, and lands as its own undo step.
        const timed = applyTimeRules(messageId);
        const goalChanges = applyGoalsFromReply(parsed, messageId, String(messageText));

        // Written even when nothing changed, so a quiet message is distinguishable from
        // a message older than the record. Costs no prompt tokens: extra is not read
        // back into the context.
        const applied = (pending.length === 0 ? changes : auto).concat(timed.rows);
        recordAppliedChanges(messageId, applied);

        if (pending.length > 0) {
            setPendingChanges(messageId, pending, unmatched, refused);
            debugLog(`${pending.length} change(s) awaiting review on message ${key}`);
        }

        extractedMessages.add(key);
        const appliedCount = auto.length + timed.rows.length + goalChanges.length;
        const parts = [
            `${appliedCount} applied`,
            `${pending.length} awaiting review`,
        ];
        if (blocked) parts.push(`${blocked} blocked by standing decisions`);
        report = { swipe, status: 'done', summary: parts.join(' · '), output: readerOutput };
        // Cleared on success so a later failure is announced rather than swallowed as a
        // repeat of one the user has already dealt with.
        lastReportedProblem = '';
        debugLog('Extraction applied for message', key);
        return { applied: true, pending: pending.length };
    } catch (err) {
        report = { ...report, status: 'failed', summary: String(err?.message || err),
            output: err?.output ?? report.output };
        console.error(LOG_PREFIX, 'Extraction failed; state left unchanged.', err);
        reportExtractionProblem(`The tracker could not read this message: ${err?.message || err}`);
        return { applied: false, reason: String(err?.message || err) };
    } finally {
        finishExtractionReport(messageId, reportMessage, report);
        if (activeExtraction === run) activeExtraction = null;
        refreshReport();
    }
}
