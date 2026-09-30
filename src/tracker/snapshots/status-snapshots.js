/** Public entry point for recorded changes and historical state. */
export { APPLIED_KEY, APPLIED_SWIPE_KEY, GLOBALS_KEY, saveChatSoon, recordAppliedChanges, getAppliedChanges, appliedChangesForCurrentSwipe, clearTurnRecord } from './status-snapshot-records.js';
export { alignSwipeBaseToNow, rebaseToSwipe, revertToBase } from './status-snapshot-swipe.js';
