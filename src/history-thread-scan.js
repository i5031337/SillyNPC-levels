import { promptText } from './prompt-texts.js';
import { getSettings } from './settings.js';
import { LOG_PREFIX } from './constants.js';
import { requestExtraction, coerceToUpdate, applyThreadsFromReply } from './status-extractor.js';
import { collectHistoryChunks, looksTruncated } from './history-scan.js';

/* ─── Reading a story that is already written ─────────────────────────────── */

/**
 * What the reader is told when it goes looking for what is unfinished.
 *
 * Its own prompt rather than a section added to the inventory scan's. That one opens with
 * "You are taking an inventory, not writing a summary" and every rule under it is about
 * what somebody is holding at the end; asking it for obligations in the same breath makes
 * both jobs vaguer, and the inventory is the one that already works.
 */
export function threadScanSystemPrompt() {
    return promptText('threadScanSystem');
}

/**
 * Reads the story so far and records what is still open.
 *
 * Threads accumulate as a story is played, so a chat that predates the feature has none.
 * This is the way to catch up without replaying five hundred messages - the same chunking
 * the inventory scan uses, because the reason for it is the same: a long story does not
 * fit in one request.
 *
 * Nothing is held for review. A thread costs a line in the prompt and closing a wrong one
 * is a click, and a review panel with forty rows in it is not a decision anybody makes.
 *
 * @param {(progress: { chunk: number, of: number }) => void} [onProgress]
 * @returns {Promise<{ ok: boolean, opened?: number, read?: number, reason?: string, failures?: number }>}
 */
export async function scanHistoryForThreads(onProgress) {
    const trackerSettings = getSettings().statusTracker;
    if (trackerSettings.threadsEnabled !== true) {
        return { ok: false, reason: 'Threads are switched off.' };
    }

    const chunks = collectHistoryChunks(trackerSettings);
    if (!chunks.length) return { ok: false, reason: 'Nothing readable in the history.' };

    const failures = [];
    let opened = 0;
    let read = 0;

    for (const [index, chunk] of chunks.entries()) {
        onProgress?.({ chunk: index + 1, of: chunks.length });

        let raw;
        try {
            raw = await requestExtraction(
                buildThreadScanPrompt(chunk.text),
                null,
                {
                    ...trackerSettings,
                    extractionMaxTokens: trackerSettings.scanMaxTokens ?? 3000,
                    extractionProfileId: trackerSettings.scanProfileId || trackerSettings.extractionProfileId,
                },
                threadScanSystemPrompt(), { usageKind: 'scan' });
        } catch (err) {
            console.error(LOG_PREFIX, `Thread scan pass ${index + 1} failed.`, err);
            failures.push(String(err?.message || err));
            continue;
        }

        const parsed = coerceToUpdate(raw);
        if (!parsed) {
            failures.push(looksTruncated(raw) ? 'a reply ran out of room' : 'a reply was not JSON');
            continue;
        }

        // Applied per pass rather than pooled. addThread already refuses a quote it has
        // seen, so two passes finding the same promise cannot record it twice, and a
        // failure late in a long scan does not throw away what the earlier ones found.
        opened += applyThreadsFromReply(parsed, null).opened;
        read += chunk.used;
    }

    if (!opened && failures.length) {
        return { ok: false, reason: failures[0], failures: failures.length };
    }
    return { ok: true, opened, read, failures: failures.length };
}

/** What the thread scan is asked, given one part of the transcript. */
export function buildThreadScanPrompt(transcript) {
    return promptText('threadScanRequest', { transcript });
}
