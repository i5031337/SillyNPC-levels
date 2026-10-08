import { getContext } from '../../../../../../st-context.js';
import { saveChatSoon, appliedChangesForCurrentSwipe } from '../snapshots/status-snapshot-records.js';
import { buildReportBreakdown } from './status-report-counts.js';
import { getSettings } from '../../core/settings.js';

const REPORT_KEY = 'sillynpc_reader_report';
const running = new WeakMap();

function messageAt(messageId) {
    return getContext()?.chat?.[Number(messageId)] ?? null;
}

/** The report follows its reply through SillyTavern's swipe-specific message.extra. */
export function getExtractionReport(messageId) {
    const message = messageAt(messageId);
    if (!message) return null;
    const swipe = Number(message.swipe_id ?? 0);
    if (running.get(message) === swipe) return { status: 'running' };
    const report = message.extra?.[REPORT_KEY];
    if (!report || report.swipe !== swipe) return null;
    if (report.status !== 'done') return report;
    const appliedRows = appliedChangesForCurrentSwipe(messageId) || [];
    const applied = appliedRows.length + (report.reviewedMemories || 0);
    const pending = message.extra?.sillynpc_pending;
    const summary = String(report.summary || '')
        .replace(/\b\d+ applied\b/, `${applied} applied`)
        .replace(/\b\d+ awaiting review\b/, `${Array.isArray(pending) ? pending.length : 0} awaiting review`);
    const tracker = getSettings().statusTracker;
    const statDefinition = row => (row.scope === 'player' ? tracker.playerStats
        : row.scope === 'global' ? tracker.globalStats : tracker.npcStats)?.find(def => def.name === row.label);
    const breakdown = buildReportBreakdown(appliedRows, Array.isArray(pending) ? pending : [],
        report.reviewedMemories || 0, statDefinition);
    return { ...report, summary, breakdown };
}

export function startExtractionReport(messageId) {
    const message = messageAt(messageId);
    if (message) running.set(message, Number(message.swipe_id ?? 0));
    return message;
}

export function finishExtractionReport(messageId, message, report) {
    if (!message) return;
    running.delete(message);
    // A request may finish after the chat or active swipe changes. Its result must not
    // appear under a different reply, or get saved into a different chat.
    if (messageAt(messageId) !== message || Number(message.swipe_id ?? 0) !== report.swipe) return;
    if (!message.extra || typeof message.extra !== 'object') message.extra = {};
    message.extra[REPORT_KEY] = report;
    saveChatSoon();
}

/** Regenerate reuses the message index and may reuse its extra object. */
export function clearExtractionReport(messageId) {
    const message = messageAt(messageId);
    if (!message) return;
    running.delete(message);
    if (message.extra) delete message.extra[REPORT_KEY];
}

export function extractionSwipe(message) {
    return Number(message?.swipe_id ?? 0);
}
