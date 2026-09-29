# Rewrite progress

This records the implementation against `REWRITE_PLAN.md` as of 2026-09-28. Node tests cover data and policy behavior; interactive SillyTavern checks remain separate.

## Implemented in source

- **Phase 0:** Documented storage boundaries, added legacy fixtures and a host smoke checklist, and traced callers of Threads, prompt overrides, checkpoints, and historical state.
- **Phase 1:** Player renders in the normal menu. HUD and persona avatar actions open that tab. Open edits commit when the view changes or closes; the separate player popup is gone.
- **Phase 2:** Versioned reusable System definitions carry stable player/NPC profile field IDs, guidance, policies, stats, collections, progression, HUD defaults, goals, and a memory limit. Fill, sheets, lore sync, transfers, and extraction use the active field registry. System Builder can add, rename, reorder, retire, and restore fields while preserving saved unknown values. New System exports omit live world data. A chat can choose a System before its first player message, then keeps it.
- **Player ownership:** Persona identity, profile, portrait, and lore remain reusable. Stats, items, goals, and memories live in chat metadata for the selected persona; old tracker chats can recover legacy values.
- **Phase 3:** Anchored fields can be seeded only when empty; replaceable fields accept sourced updates; memory fields append sourced, deduplicated entries. Manual edits remain available. Active memory count is configurable (default 50), with older entries archived. Reader application and review enforce field policy.
- **Phase 4:** Configured player and NPC goals appear in sheets, HUD, and the Goals tab. The reader proposes sourced set, replace, and complete actions. Old Threads remain readable in the Goals archive; live Thread scanning, ranking, settings, and prompt injection are retired.
- **Phase 5:** Latest-reply changes use one pre-turn base and are rebased on swipe, regeneration, latest-reply edit, and deletion. One-step undo remains visible. Historical tracker boxes, arbitrary old-message restore, multi-entry undo, and automatic System checkpoints are retired. Old stored records remain loadable.
- **Phase 6 cleanup:** Reader and Fill prompts use System schema/guidance. Raw prompt editing and the Prompts tab are removed; extraction diagnostics remain. Portrait generation uses SillyTavern Image Generation's `/imagine` and its configured provider. The HUD reads the same current state as Player and offers Plate, Underlines, Pip Rows, and Split Ring layouts; older layout IDs map to a retained style. New installs auto-apply valid reader changes; saved review choices remain intact.

## Remaining verification and limits

- Run `REWRITE_HOST_SMOKE.md` in an authenticated SillyTavern session. The available host responded, but this rewrite has not had a controllable session for the full interactive check. In particular, verify Player/Goals menu behavior, Fill and lore sync, image generation, HUD redraws, review application, and swipe/regenerate/edit/delete rebase with real host events.
- A user smoke run found an Underlines text overlap, stingy XP awards, tracker display on the home screen, and tracker loss after image messages. Source fixes now address those cases, and Fill can create a chat lorebook when no target exists. Recheck the Phase 7 cases in `REWRITE_HOST_SMOKE.md` in the host.
- The legacy System world archive is transitional. Switching among old imported Systems can still restore their archived world payloads; new reusable System exports do not include that payload.
