import { getContext } from '../../../../../st-context.js';
import { isGenerating } from '../../../../../../script.js';
import { getSettings } from '../core/settings.js';
import { LOG_PREFIX } from '../core/constants.js';
import { getAllCharacters } from '../characters/character-repository.js';
import { loadStateFromMetadata, saveStateToMetadata } from '../tracker/status-logic.js';
import { saveChatSoon } from '../tracker/snapshots/status-snapshots.js';
import { getPendingChanges, getLooseNotes, getRefusedValues, setPendingChanges, appendPendingMemoryChanges } from '../tracker/status-review.js';
import { requestExtraction, coerceToUpdate } from '../tracker/extractor/status-extractor-request.js';
import { isExtractionRunning } from '../tracker/extractor/status-extractor-run.js';
import { syncProfileToLore } from '../lore/lore-sync.js';
import { createMemoryService } from './memory-service.js';

let refreshButton = () => {};
let timer = null;
let seenChat;
let lastSeen = -1;
const service = createMemoryService({
    getContext, getSettings, getCards: getAllCharacters, loadState: loadStateFromMetadata,
    saveState: saveStateToMetadata, saveChat: saveChatSoon,
    request: requestExtraction, parse: coerceToUpdate, getPending: getPendingChanges,
    enqueue: appendPendingMemoryChanges,
    replacePending: (id, rows) => setPendingChanges(id, rows, getLooseNotes(id), getRefusedValues(id), { replaceMemory: true }),
    busy: () => isGenerating() || isExtractionRunning(),
    onBusy: () => refreshButton(),
    syncLore: (card, store) => {
        const context = getContext();
        const chatId = context?.getCurrentChatId?.();
        syncProfileToLore(card, store, { isCurrent: () => getContext()?.chat === context?.chat
            && getContext()?.getCurrentChatId?.() === chatId }).catch(error =>
            console.error(LOG_PREFIX, 'Could not sync NPC memories to lore', error));
    },
});

export const readMemories = options => service.read(options);
export const memoryReaderBusy = () => service.busy();
export function setMemoryButtonRefresh(callback) { refreshButton = callback; }

/** Reconcile source changes without making any model requests. */
export function reconcileMemorySources() {
    try { service.reconcile(); }
    catch (error) { console.error(LOG_PREFIX, 'Could not reconcile memory sources', error); }
}

/** Historical re-renders and chat loading do not schedule new requests. */
export function resetMemorySchedule() {
    clearTimeout(timer);
    timer = null;
    seenChat = getContext()?.chat;
    lastSeen = (seenChat?.length ?? 0) - 1;
    reconcileMemorySources();
    refreshButton();
}

export function scheduleMemoryRead(messageId) {
    const chat = getContext()?.chat;
    if (chat !== seenChat) { resetMemorySchedule(); return; }
    const id = Number(messageId);
    if (id <= lastSeen || id !== (chat?.length ?? 0) - 1) return;
    lastSeen = id;
    clearTimeout(timer);
    const runChat = chat;
    const attempt = async () => {
        timer = null;
        if (getContext()?.chat !== runChat || !getSettings().enabled) return;
        if (isGenerating() || isExtractionRunning()) {
            timer = setTimeout(attempt, 500);
            return;
        }
        const result = await readMemories();
        if (!result.ok && !['Not enough new replies for a memory pass.', 'NPC memory capture is disabled for this System.',
            'A memory reading is already running.'].includes(result.reason)) {
            console.warn(LOG_PREFIX, 'Memory reading:', result.reason);
            if (typeof toastr !== 'undefined') toastr.warning(result.reason, 'NPC memories');
        }
    };
    timer = setTimeout(attempt, 250);
}
