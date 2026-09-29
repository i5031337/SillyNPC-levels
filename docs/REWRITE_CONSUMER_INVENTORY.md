# Rewrite consumer inventory (baseline)

Source inventory for phases 1, 4, 5, and 6 of `REWRITE_PLAN.md`. This is a code-path inventory, not a claim that the host behavior has been verified. “History scan” reads the chat transcript and is distinct from the per-message state records below.

## Per-message state records and undo history

| Stored shape or API | Writers | Readers and visible behavior | Rewrite dependency |
| --- | --- | --- | --- |
| `message.extra.sillynpc_applied`, `sillynpc_applied_swipe`, `sillynpc_globals`, `sillynpc_chars` | `src/tracker/snapshots/status-snapshot-records.js` via `recordAppliedChanges`; review acceptance in `src/tracker/status-review.js` and extractor flow | `src/tracker/snapshots/status-snapshot-timeline.js` reconstructs historical state; `src/tracker/ui/status-ui-box.js` draws a box for an older message; `src/ui/characters/ui-player-modal.js` offers player history and restore; `src/tracker/snapshots/status-snapshot-swipe.js` replays the selected swipe; `src/story/history-notes.js` uses saved globals for historical note text | Keep a reliable latest-reply record/base for swipe in phase 5. Historical box, player restore, and historical note behavior need an explicit retirement or replacement decision before removing the timeline. `recordMessageHistory` in `src/core/settings-tracker-defaults.js` gates the record writer. |
| `message.extra.sillynpc_edits` | `src/tracker/ui/status-ui-edit.js` calls `recordMessageEdit` in `src/tracker/snapshots/status-snapshot-edits.js` | `src/tracker/snapshots/status-snapshot-timeline.js` and swipe replay apply manual corrections | Phase 5 must preserve corrections separately from the chosen reply’s extraction. |
| `message.extra.sillynpc_threads` | `recordThreadChanges` from `src/tracker/extractor/status-extractor-replies.js` | `src/tracker/snapshots/status-snapshot-swipe.js` replays opened/closed threads | Replace with goal changes or retain read-only old records until goals and latest-reply rebase work. |
| Chat metadata `sillynpc_status_history` | `saveStateToMetadata` in `src/tracker/status-state-storage.js` | `undoLastChange`, `getHistoryEntries`, `restoreHistoryEntry`; `src/tracker/ui/status-ui-box.js` shows undo depth; `src/ui/tracker/ui-tracker-popups.js` shows the multi-entry restore picker | Phase 5 retains one-step undo and removes the old multi-entry UI. `statusTracker.historyDepth` controls ring length. |
| Swipe base and profile snapshot in chat metadata | `src/tracker/status-chat-session.js`, `src/tracker/snapshots/status-snapshot-swipe.js` | `src/entry/entry-message-events.js` handles swipe/revert; `index.js` aligns base on load; extractor prompt/reply flow records profile changes | Must become the single pre-turn base keyed to chat/message/reply in phase 5; do not discard until edit, delete, regenerate, and chat switch paths pass host checks. |

`src/tracker/snapshots/status-snapshots.js` is the public facade. `src/tracker/status-logic.js` exposes undo/history from state storage. `src/ui/tracker/ui-tracker-time.js`, `ui-tracker-context.js`, and `ui-tracker-history.js` import history APIs through a shared import list but do not appear to call them; remove those imports during cleanup. `src/story/history-scan.js` and `src/tracker/status-history.js` concern transcript scanning/cleanup, not the per-message state timeline.

## Threads

| Consumer | Current use |
| --- | --- |
| `src/story/threads.js` | Thread schema, add/close/reopen/pin, ranking, pruning, and prompt description. `state.threads` is the live chat field. |
| `src/tracker/extractor/status-extractor-replies.js` | Applies reader-proposed `threads` and `closed`, touches/prunes them, records changes on messages, and tidies on chat load. |
| `src/tracker/extractor/status-extractor-prompt.js`, `src/core/constants-prompts.js`, `src/prompts/prompt-texts-reader.js` | Reader instructions/schema for proposing thread changes. |
| `src/tracker/status-status-summary.js`, `src/tracker/status-scene-prompt.js` | Carries `describeThreads` into the story scene block. |
| `src/story/history-thread-scan.js`, `src/story/history-scan.js` | Optional transcript scan to seed threads. |
| `src/ui/story/ui-threads.js`, `src/ui/manage/ui-manage.js`, `manage.html`, `styles/11-character-threads.css` | Threads tab, settings, manual add, pin, close/reopen, scan, and display. |
| `src/tracker/ui/status-ui-report.js`, `src/tracker/snapshots/status-snapshot-{records,swipe}.js`, `index.js` | Review label, message record/replay, load tidy. |

Thread settings (`threadsEnabled`, `threadsInjectedMax`, `threadsOpenMax`, `threadsClosedKeep`, `threadsHalfLife`) live in `src/core/settings-tracker-defaults.js`. The agreed phase 4 behavior is to keep old Threads archived and readable when Goals replaces them; the new path should stop writing/injecting them. The timeline's thread record is separate from live `state.threads`.

## Prompt overrides

| Storage/editor | Runtime consumers |
| --- | --- |
| `settings.promptTexts[id]`, initialized in `src/core/settings-base-migration.js`; defaults and placeholder expansion in `src/prompts/prompt-texts.js`; catalog in `src/prompts/prompt-texts-{reader,other}.js` and `src/prompts/prompts.js` | Reader (`src/tracker/extractor/status-extractor-prompt.js`), Fill (`src/characters/character-fill.js`), level bonuses (`src/tracker/extractor/status-extractor-replies.js`), scene/story block (`src/tracker/status-{scene-prompt,status-summary}.js`), lore (`src/api/api-lore-{generate,facts}.js`), history scans (`src/story/history-{scan,thread-scan}.js`), history notes (`src/entry/entry-history-notes.js`), ban scan (`src/prompts/banlist.js`), and usage estimates (`src/ui/shared/ui-stats.js`). |
| Top-level `dialogueFormatPrompt`, `narratorRulesPrompt`, `generationPrompt`, `imgGenPrompt`; tracker `extractionPrompt`, `systemRules` in `src/core/settings-*.js` | Dialogue/narrator prompt modules, lore generation, image prompt helper, extraction request, and scene prompt. `src/prompts/prompts.js` catalogs these editors. |
| `src/ui/shared/ui-prompts.js` | Full Prompts tab via `src/ui/manage/ui-manage.js`; duplicate contextual editors in tracker reading and settings writing/generation/image views. |

Phase 6 can remove the general editor only after deciding which individual overrides remain. Schema-derived reader and Fill prompts must still use the active System. Existing settings exports with override keys should remain loadable even if the UI no longer exposes every key.

## System checkpoints

`src/tracker/status-checkpoints.js` saves, restores, deletes, and schedules full System snapshots, with checkpoint metadata on the System preset and payload files. `src/ui/system/ui-system-manager.js` exposes manual save/restore/delete. `index.js` starts the schedule; `src/ui/tracker/ui-tracker-cast-recovery.js` exposes interval/count settings and restarts it; `src/tracker/status-logic.js` is the facade. Defaults are `systemAutoSaveMinutes` and `systemCheckpointsKept` in `src/core/settings-tracker-defaults.js`; `src/tracker/status-system-presets.js` treats them as user habits rather than System rules. Phase 5 retirement must account for both UI and timer, and existing preset checkpoint metadata must be tolerated.

## Separate player popup

`openPlayerModal` in `src/ui/characters/ui-player-modal.js` owns the Popup shell, tabs, Fill, portrait, lore, profile, stat/collection editing, level badge, and historical restore picker. `src/ui/characters/ui-player-sections.js` imports modal state and refresh helpers, so moving the view requires untangling that cycle. Entry points are `src/entry/entry-avatar-actions.js` (player avatar) and HUD modules `src/ui/hud/ui-hud.js`, `ui-hud-render.js`, `ui-hud-portrait.js`, and `ui-hud-meters.js`. Phase 1 should make these open the Player menu tab and make `manage.html`/`src/ui/manage/ui-manage.js` render the same sheet. The menu currently has Characters but no Player tab.
