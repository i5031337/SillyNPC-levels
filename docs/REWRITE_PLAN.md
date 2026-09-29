# SillyNPC XP: staged rewrite plan

This plan implements [the product spec](PRODUCT_SPEC_DRAFT.md). It is a sequence of reviewable changes, not a requirement to retain every existing feature. Dialogue styling, portrait generation, lorebook integration, chat ownership, and player XP are useful starting points.

## Ground rules

- Keep existing chats, settings exports, and character exports readable. Convert old shapes at load/import boundaries; do not carry compatibility branches through every new feature.
- Keep a chat's cast and story state separate from a reusable genre System. Keep persona identity separate from a chat's current player values.
- One-click Fill may seed an empty profile. The per-turn reader follows each field's update policy and cannot rewrite anchored identity.
- Finish and verify each phase before removing the old path it replaces. Use focused Node tests for state logic and a running SillyTavern instance for menu, events, generation, and rendering.
- Keep every source file under 20 kB.

## Phase 0 — Establish the baseline

1. Record the existing settings, chat metadata, character export, and System export shapes. Save representative fixtures for an old chat, a chat-owned NPC, a linked lorebook entry, a player with XP, and a saved System.
2. Make a host smoke checklist: dialogue styling; create and Fill an NPC; edit a profile and sync lore; run and review turn extraction; award XP and level up; switch chats/personas; swipe, regenerate, and edit the latest reply.
3. Find every consumer of per-message history, Threads, prompt overrides, checkpoints, and the separate player popup before removing them.

**Done when:** the fixtures load and the checklist records what currently works. Commit or set aside the current uncommitted source changes before implementation.

## Phase 1 — One player sheet in the menu

1. Add **Player** beside **Characters** in `manage.html` and the menu renderer in `src/ui/manage/ui-manage.js`.
2. Extract player-sheet content and edit actions from `src/ui/characters/ui-player-modal.js` into a view that renders in the menu. Reuse profile, collection, and stat controls where possible.
3. Make the HUD player action open the menu's Player tab. Remove the second popup shell after Fill, portrait, lore, edit-save, and level display work in the tab.

**Done when:** the sheet works with the HUD hidden; HUD and menu reach the same view; closing or switching tabs saves open edits once; changing chat or persona shows the correct player. Do not change persistence in this phase.

## Phase 2 — Reusable genre Systems

1. Define a versioned System schema for player/NPC profile fields, stats, collections, field guidance and update policy, progression, and HUD defaults. Give fields stable IDs independent of display labels.
2. Separate System configuration from the current `world` payload of characters, persona data, and item library in `src/tracker/status-system-presets.js`. A chat uses a System definition while retaining its own cast and state.
3. Move hardcoded profile definitions from `src/core/constants-profile.js` into System data. Make Fill, editors, lore sync/format, extraction schema, prompts, and transfers read one resolved field registry.
4. Add System Builder controls to add, rename, reorder, and retire profile fields. Preview value mapping before a chat changes Systems.
5. Import old Systems and fixed-profile cards through a bounded migration. Preserve unknown fields so changing a schema cannot erase prose silently.

**Done when:** sci-fi, fantasy, and modern Systems can use different player/NPC profiles; chats sharing a System do not share NPCs or live state; old chats and exports still open. Split this phase into separate data-model, reader, and UI commits.

## Phase 3 — Profile policy and memories

1. Give each profile field an `anchored`, `replaceable`, or `memory` policy. Appearance and personality default to anchored; Fill writes them only while empty. User edits are always allowed.
2. Ask the reader to propose only eligible changes. Enforce the policy again when applying a result, including saved pending reviews and old prompt results.
3. Store memories as separate entries with text and a source message or manual-source marker. Deduplicate repeats; let the user edit or remove entries; bound prompt injection.
4. Sync the resolved profile and memories to lorebook entries without letting an asynchronous turn update overwrite anchored text.

**Done when:** turns cannot change anchored identity; Fill still creates a new NPC; a new memory appears once and survives reload, lore sync, review, and latest-turn regeneration.

## Phase 4 — Goals instead of Threads

1. Add configured NPC short-term and player short-/long-term goal fields. Show them in sheets and HUD when configured.
2. Propose goal changes with a source and explicit completion/replacement behavior. Start with current goal fields; a separate quest list is optional.
3. Stop creating Threads once goals work. Keep old thread records readable and choose an explicit import/archive behavior; do not turn every promise into a quest.
4. Remove thread ranking, scanning, prompt injection, settings, and UI after their callers are retired.

**Done when:** goals are visible without a separate panel, change when the story warrants it, and remain consistent across chat changes and regeneration.

## Phase 5 — Latest-turn consistency

1. Save one pre-turn base for state, relevant profile/memory writes, and goals. Key it to chat, message, and swipe/reply identity.
2. For each SillyTavern action changing the latest reply, restore the base and apply only the chosen reply's accepted changes. Preserve manual corrections made after the turn separately.
3. Keep one-step user undo. Verify repeated swipe, over-swipe/new reply, regenerate, message edit/delete, extraction retry, and chat switch. A failed rebase must warn visibly and avoid committing mismatched state.
4. Retire `src/tracker/snapshots/status-snapshot-timeline.js`, old per-message history UI, multi-entry undo, and checkpoints when no remaining feature uses them. Existing saved history must not prevent a chat from loading.

**Done when:** replies never accumulate another reply's changes, manual corrections remain intact, and arbitrary old-turn restoration is no longer exposed.

## Phase 6 — Prompts, HUD, and cleanup

1. Generate maintained reader and Fill prompts from the active System's schema, guidance, and current context. Keep request/response diagnostics. Remove the general prompt editor if no essential workflow uses it.
2. Make the HUD a concise view of the same state shown in Player and NPC sheets. Trim redundant layouts and controls after choosing the retained designs.
3. Remove unused UI, CSS, settings, facade exports, and obsolete migration paths. Update the file map and user docs.

**Done when:** dialogue recognition, Fill, extraction, review, XP, lore, and HUD work in a running SillyTavern instance; old data fixtures load; `node --experimental-default-type=module --test tests/*.mjs` passes.

## Phase 7 — Host polish found during smoke checks

1. When Fill needs a lorebook and neither the chat nor the extension has an active target, create a lorebook, bind it to the current chat, and write the new entry there. Preserve an existing chat/default lorebook choice.
2. Hide the tracker when no chat is open, including on SillyTavern's home screen. Show it again when a chat with tracker data opens.
3. Keep the tracker visible and attached to the correct latest message after an image is generated in chat, whether tracker placement is configured above or below that message.
4. Verify the retained HUD layouts against real stat names and values, including Underlines with Energy and XP. Keep the text and meter layers readable.
5. Award XP for evidenced minor accomplishments as well as larger milestones. Reiterate the XP rule near the end of the reader prompt and verify that extraction still reports an absolute XP total, which progression converts to a level and remainder.

**Done when:** each behavior passes in an authenticated SillyTavern session, including chat switches, image messages, a chat without an active lorebook, and a player close to a level boundary.

## Decisions to settle while implementing

- Memory retention: maximum entries, grouping, and whether old memories are summarized.
- Goals: plain current fields first, or a structured quest list from the start.
- System switching: map values mid-chat, or require a new chat for a different System.
- Review defaults: which stat, item, goal, and memory proposals auto-apply.
- Portrait backends and advanced prompt overrides: retain only options actually needed.
