# Rewrite progress

This records implementation against `REWRITE_PLAN.md`, updated 2026-09-29. Node tests cover data and policy behavior; host results below are from the user's interactive SillyTavern smoke test.

## Implemented in source

- **Phase 0:** Documented storage boundaries, added legacy fixtures and a host smoke checklist, and traced callers of Threads, prompt overrides, checkpoints, and historical state.
- **Phase 1:** Player renders in the normal menu. HUD and persona avatar actions open that tab. Open edits commit when the view changes or closes; the separate player popup is gone.
- **Phase 2:** Versioned reusable System definitions carry stable player/NPC profile field IDs, guidance, policies, stats, collections, progression, HUD defaults, goals, and a memory limit. Fill, sheets, lore sync, transfers, and extraction use the active field registry. System Builder can add, rename, reorder, retire, and restore fields while preserving saved unknown values. New System exports omit live world data. A chat can choose a System before its first player message, then keeps it.
- **Player ownership:** Persona identity, profile, portrait, and lore remain reusable. Stats, items, goals, and memories live in chat metadata for the selected persona; old tracker chats can recover legacy values.
- **Phase 3:** Anchored fields can be seeded only when empty; replaceable fields accept sourced updates; memory fields append sourced, deduplicated entries. Manual edits remain available. Active memory count is configurable (default 50), with older entries archived. Reader application and review enforce field policy.
- **Phase 4:** Configured player and NPC goals appear in sheets, HUD, and the Goals tab. The reader proposes sourced set, replace, and complete actions. Thread scanning, ranking, settings, prompt injection, archive UI, and replay are retired.
- **Phase 5:** Latest-reply changes use one pre-turn base and are rebased on swipe, regeneration, latest-reply edit, and deletion. One-step undo remains visible. Historical tracker boxes, arbitrary old-message restore, multi-entry undo, and automatic System checkpoints are retired. Old stored records remain loadable.
- **Phase 6 cleanup:** Reader and Fill prompts use System schema/guidance. Raw prompt editing and the Prompts tab are removed; extraction diagnostics remain. Portrait generation uses SillyTavern Image Generation's `/imagine` and its configured provider. The HUD reads the same current state as Player and offers Plate, Underlines, Pip Rows, and Split Ring layouts; older layout IDs map to a retained style. New installs auto-apply valid reader changes; saved review choices remain intact.

## Host verification and remaining limit

- On 2026-09-29, the user reported thoroughly testing the host smoke checklist and confirmed its behavior apart from level-up mechanics. The earlier Underlines overlap, sparse minor XP awards, home-screen tracker, image-message tracker loss, and missing lorebook target are covered by that report. `REWRITE_HOST_SMOKE.md` records the individual results.
- Level-up across an XP boundary, level bonus application and retry, and the resulting Player/HUD level display still need a host check. The Node progression and bonus-retry tests pass, but they cannot prove the host flow.
- Legacy System world archives and world restoration were removed. Importing an old System retains its rules and discards its embedded characters, persona records, and item library. Existing root `systemWorldArchive` data is cleared when settings load. Old Threads are no longer displayed or replayed. New System exports contain only reusable rules.
