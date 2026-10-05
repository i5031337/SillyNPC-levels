import { getContext } from '../../../../../../st-context.js';
import { getSettings } from '../../core/settings.js';
import { getAllCharacters } from '../../characters/character-repository.js';
import { loadStateFromMetadata, applyUpdate, sanitizeModelUpdate, parseMessageForUpdates,
    rememberSwipeBase, refreshTurnBase, getCurrentPersonaKey } from '../status-logic.js';
import { computeStateDiff, partitionChanges, buildUpdateFromChanges, attachReasons } from '../status-diff.js';
import { setPendingChanges, isItemDecided } from '../status-review.js';
import { recordAppliedChanges } from '../snapshots/status-snapshots.js';
import { replacementReadingState, revertToBase } from '../snapshots/status-snapshot-swipe.js';
import { trackerMessageIndex } from '../ui/status-ui-placement.js';
import { renderStatusTrackerBox } from '../ui/status-ui-box.js';
import { expandNumericDeltas } from './status-extractor-deltas.js';
import { prepareGrantReview, validateReviewedTransitions } from '../level-grant-review.js';
import { prepareLevelReading, saveLevelReading } from './status-level-reading.js';
import { collectLeadUp } from './status-extractor-prompt.js';
import { normalizeCollectionUpdates } from './status-collection-normalize.js';
import { finishExtractionReport } from './status-extraction-report.js';

const queued = new WeakMap();
const READING_KEY = 'sillynpc_inline_reading';

/** The inline block has the same XP delta boundary and review rules as a reader reply. */
export function queueInlineReading(update, messageId, mesEl, fingerprint) {
    const context = getContext();
    const message = context?.chat?.[Number(messageId)];
    const tracker = getSettings().statusTracker;
    // Archived inline blocks are display data. Loading an old turn never earns levels.
    if (!message || message.is_user || Number(messageId) !== trackerMessageIndex(context.chat)
        || mesEl.classList.contains('writing') || tracker.extractionMode !== 'inline') return false;
    const swipe = message.swipe_id ?? 0;
    const token = JSON.stringify([swipe, fingerprint]);
    if (queued.get(message) === token || message.extra?.[READING_KEY]?.token === token) return false;
    const regenerate = Boolean(message.extra?.[READING_KEY]);
    queued.set(message, token);
    const metadata = context.chatMetadata;
    const source = message.mes;
    const cleaned = parseMessageForUpdates(source).cleanedText;
    const fresh = () => getContext()?.chatMetadata === metadata
        && getContext()?.chat?.[Number(messageId)] === message
        && (message.swipe_id ?? 0) === swipe
        && Number(messageId) === trackerMessageIndex(getContext()?.chat)
        && [source, cleaned].includes(message.mes);
    // Defer beyond DOM surgery; status stripping can change message.mes to cleaned text.
    Promise.resolve().then(async () => {
        if (!fresh()) return;
        const state = regenerate ? replacementReadingState(messageId) : loadStateFromMetadata();
        if (!state) return;
        rememberSwipeBase(messageId, state);
        const parsed = structuredClone(update);
        normalizeCollectionUpdates(parsed, tracker, state, getAllCharacters());
        expandNumericDeltas(parsed, state, tracker, { cards: getAllCharacters() });
        sanitizeModelUpdate(parsed, state, tracker);
        const leadUp = collectLeadUp(messageId, Number(tracker.extractionContextMessages ?? 2));
        const grants = await prepareLevelReading(parsed, state, tracker, cleaned || source, leadUp,
            message, messageId, { regenerate });
        if (!fresh() || grants.reading.personaId !== getCurrentPersonaKey()) return;
        const freshState = regenerate ? replacementReadingState(messageId) : loadStateFromMetadata();
        if (!freshState) return;
        const freshness = validateReviewedTransitions(grants.transitions.map(transition => ({
            scope: transition.scope, actor: transition.actor, transition,
        })), freshState, getSettings().statusTracker, getAllCharacters(), getCurrentPersonaKey());
        if (freshness.invalid.size) return;
        if (regenerate) {
            if (!revertToBase(messageId).reverted) return;
            delete message.extra.sillynpc_applied;
        }
        refreshTurnBase(messageId);
        const before = loadStateFromMetadata();
        const preview = applyUpdate(parsed, { dryRun: true, admitCharacters: true });
        const changes = computeStateDiff(before, preview, tracker).filter(row => !isItemDecided(row));
        const notes = attachReasons(changes, parsed.why);
        const { auto, pending } = partitionChanges(changes, tracker);
        pending.push(...grants.rows.filter(row => !isItemDecided(row)));
        prepareGrantReview(auto, pending, grants.transitions);
        if (auto.length) applyUpdate(buildUpdateFromChanges(auto, before, tracker, getAllCharacters()),
            { partOfMessage: true, allowAdvancementChanges: true, admitCharacters: true });
        recordAppliedChanges(messageId, auto);
        grants.reading.sourceText = message.mes;
        saveLevelReading(message, grants.reading);
        setPendingChanges(messageId, pending, notes);
        message.extra ||= {};
        message.extra[READING_KEY] = { token, swipe };
        finishExtractionReport(messageId, message, { swipe: Number(swipe), status: 'done',
            summary: `${auto.length} applied · ${pending.length} awaiting review`
                + (grants.failures.length ? ` · ${grants.failures.length} level-up choices need retry` : ''),
            output: structuredClone(update) });
        renderStatusTrackerBox(mesEl);
    }).catch(error => {
        console.warn('[SillyNPC] Inline tracker reading failed:', error);
        if (fresh() && typeof toastr !== 'undefined') toastr.warning(String(error?.message || error), 'SillyNPC');
    }).finally(() => {
        if (queued.get(message) === token) queued.delete(message);
    });
    return true;
}
