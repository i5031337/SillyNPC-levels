# File map

SillyTavern loads `index.js` and `style.css` from `manifest.json`. The JavaScript entry point imports the feature modules under `src/`.

## Source directories

| Directory | Responsibility |
| --- | --- |
| `src/entry/` | SillyTavern event and avatar handlers. |
| `src/core/` | Constants, settings, System schemas, active profile fields, memories, migrations, and shared utilities. |
| `src/api/` | Lore and image generation and file operations. |
| `src/characters/` | Character records, ownership, portraits, and transfer. |
| `src/chat/` | Chat ownership, message decoration, and reprocessing. |
| `src/lore/` | Lorebook entries and synchronization. |
| `src/story/` | Story beats, archived thread records, mentions, and collection scans. |
| `src/prompts/` | Built-in prompt templates, formatting rules, and prompt placement. |
| `src/tracker/` | Current state, progression, goals, memories, updates, and review; `extractor/`, `snapshots/`, and `ui/` hold focused parts. |
| `src/ui/` | Management, HUD, settings, character, collection, system, tracker, API, and story views. |

## Project files

| File | Responsibility |
| --- | --- |
| `manifest.json` | SillyTavern extension metadata, entry points, and generation interceptor. |
| `index.html` | Settings panel markup. |
| `manage.html` | Management popup markup. |
| `README.md` | Installation, features, and usage documentation. |
| `LICENSE` | Project license. |
| `docs/chat-owned-npcs-plan.md` | Design notes for chat-owned NPCs. |
| `docs/FILE_MAP.md` | This source map. |
| `docs/PRODUCT_SPEC_DRAFT.md`, `docs/REWRITE_PLAN.md` | Product direction and staged rewrite plan. |
| `docs/REWRITE_DECISIONS.md` | Resolved rewrite behavior choices. |
| `img/SillyNPCLogo.jpg` | Extension logo. |
| `img/charactersexmp.png`, `img/charcterexmp.png`, `img/chatexmp.png` | Character and chat screenshots in the README. |
| `img/floathudbar.png`, `img/floathudcircle.png`, `img/playerexmp.png` | HUD and player screenshots in the README. |
| `img/stats.png`, `img/styleexmp.png` | Stats and appearance screenshots in the README. |
| `tests/character-scope.mjs` | Character visibility and pattern tests. |
| `tests/chat-npc-sources.mjs` | Chat NPC source routing tests. |
| `tests/fill-preset.mjs` | Automatic fill stage tests. |
| `tests/progression.mjs` | XP advancement tests. |
| `tests/stat-persistence.mjs` | NPC persistence rule tests. |
| `tests/status-apply-update.mjs` | Tracker update, dry-run, and no-chat behavior tests. |
| `tests/settings-migration.mjs` | Settings import repair and version-gated HUD migration tests. |
| `tests/system-schema.mjs` | System definition normalization and legacy import tests. |
| `tests/system-profile-builder.mjs` | System profile field edit operations. |
| `tests/player-chat-ownership.mjs` | Persona identity and chat-local player state boundaries. |
| `tests/profile-memories.mjs` | Profile memory list normalization and capacity behavior. |
| `tests/profile-memories-ui.mjs`, `tests/npc-memories.mjs` | Player/NPC memory display and persistence behavior. |
| `tests/profile-update-policy.mjs` | Anchored, replaceable, and memory update policy behavior. |
| `tests/goals.mjs`, `tests/goal-proposals.mjs` | Chat goals and sourced reader proposals. |
| `tests/turn-delta.mjs` | Current turn change reversal and rebase behavior. |
| `tests/status-dependencies.mjs` | Shared status dependency provider contract test. |
| `tests/ui-maintenance.mjs` | Lore generation and character editor routing tests. |

## Runtime and data

| File | Responsibility |
| --- | --- |
| `index.js` | Initialize the extension, register SillyTavern events, and mount settings. |
| `src/entry/entry-message-events.js` | Message, swipe, regeneration, latest-reply edit, and deletion event handlers. |
| `src/entry/entry-avatar-actions.js` | Character and player avatar click actions. |
| `src/entry/entry-chat-scope.js` | Prompt to scope a chat to its characters. |
| `src/entry/entry-history-notes.js` | Manage copied historical notes on messages. |
| `src/core/constants.js` | Extension constants, themes, profile schema, and built-in writing/image prompts. |
| `src/core/constants-base.js` | Base extension, theme, layout, and image constants. |
| `src/core/constants-profile.js` | Legacy player and NPC profile fields and defaults. |
| `src/core/profile-fields.js` | Resolve the active System's player and NPC fields, with legacy fallback. |
| `src/core/profile-memories.js` | Normalize and edit bounded character memory lists. |
| `src/core/profile-update-policy.js` | Enforce System profile update policies for turn reads. |
| `src/core/constants-prompts.js` | Built-in status and image prompt constants. |
| `src/core/settings.js` | Default settings, normalization, persistence, and settings transfer. |
| `src/core/settings-defaults.js` | Default settings catalog. |
| `src/prompts/default-prompt-texts.js` | Built-in lore prompt defaults. |
| `src/core/settings-tracker-defaults.js` | Default tracker settings. |
| `src/core/settings-migration.js` | Normalize settings across versions. |
| `src/core/settings-base-migration.js` | Normalize common settings and their defaults. |
| `src/core/settings-store-migration.js` | Normalize stored collections and presets. |
| `src/core/system-schema.js` | Versioned reusable System definitions, profile policy, and bounded legacy preset normalization. |
| `src/core/utils.js` | Image preparation, JSON repair, stat display, downloads, and DOM helpers. |
| `src/core/utils-media.js` | Image resizing, upload preparation, and media helpers. |
| `src/core/utils-format.js` | JSON, stat display, text, and DOM formatting helpers. |
| `src/core/hash.js` | Stable hashes and palette indexes. |
| `src/api/api.js` | Lore generation and image upload, generation, adoption, and cleanup. |
| `src/api/api-lore-facts.js` | Assemble lore and tracked fact context. |
| `src/api/api-lore-generate.js` | Generate and save lore content. |
| `src/api/api-image-files.js` | Image storage, listing, adoption, and cleanup. |
| `src/api/api-image-generate.js` | Portrait prompt assembly and SillyTavern Image Generation `/imagine` call. |
| `src/core/usage.js` | Model usage accounting. |
| `src/core/tokens.js` | Token budget readout. |
| `src/tracker/progression.js` | XP advancement and level bonus calculations. |
| `src/tracker/stat-persistence.js` | Rules for NPC stat persistence. |
| `src/tracker/stat-update-policy.js` | Turn and advancement update policy for stats. |
| `src/tracker/status-clock.js` | Story clock parsing and elapsed time. |
| `src/tracker/status-rules.js` | Time-based stat rules. |
| `src/tracker/status-history.js` | Raw status block preservation and chat overhead measurement. |
| `src/tracker/status-logic.js` | Player and NPC state, model updates, cast, items, and Systems. |
| `src/tracker/status-stat-values.js` | Stat value merging and numeric constraints. |
| `src/tracker/status-stat-schema.js` | Stat definition lookup and schema helpers. |
| `src/tracker/status-persona-state.js` | Reusable persona identity/profile and chat-local player stats, collections, goals, and memories. |
| `src/tracker/status-chat-session.js` | Chat persona/system session lifecycle. |
| `src/tracker/status-state-storage.js` | Load and save status metadata, including one-step undo. |
| `src/tracker/status-status-summary.js` | Format status summaries. |
| `src/tracker/status-scene-prompt.js` | Build scene context and status instructions. |
| `src/tracker/status-update-parser.js` | Parse model status update text. |
| `src/tracker/status-update-constraints.js` | Validate update values against configured fields. |
| `src/tracker/status-apply-update.js` | Apply accepted model updates to state. |
| `src/tracker/status-cast-decisions.js` | Record player, excluded, and character cast decisions. |
| `src/tracker/status-scene-presence.js` | Reconcile scene presence and active characters. |
| `src/tracker/status-collection-updates.js` | Add, remove, and update tracked items. |
| `src/tracker/status-collection-schema.js` | Rename collection fields and stat schema references. |
| `src/tracker/status-system-presets.js` | Active System, reusable definitions, chat locking, and legacy world archive migration. |
| `src/tracker/goals.js` | Configured player/NPC goal fields, changes, and offstage goal retention. |
| `src/tracker/goal-proposals.js` | Validate and apply sourced goal proposals from the reader. |
| `src/tracker/npc-memories.js` | Store NPC memories in chat-owned or reusable character records. |
| `src/tracker/status-diff.js` | Public entry point for state difference and review helpers. |
| `src/tracker/status-diff-compare.js` | Compare stats and collections across states. |
| `src/tracker/status-diff-review.js` | Attach reasons, partition decisions, and rebuild accepted updates. |
| `src/tracker/status-review.js` | Pending changes and item decision rules. |
| `src/tracker/snapshots/status-snapshots.js` | Public entry point for turn records and swipe state. |
| `src/tracker/snapshots/status-turn-delta.js` | Revert one assistant turn's applied tracker changes. |
| `src/tracker/snapshots/status-row-replay.js` | Read legacy applied rows when rebasing older replies. |
| `src/tracker/snapshots/status-rebase-lore.js` | Reconcile lore after latest-turn rebase. |
| `src/tracker/snapshots/status-snapshot-records.js` | Store current turn changes and read older applied rows. |
| `src/tracker/snapshots/status-snapshot-swipe.js` | Align and restore the latest assistant reply across swipes and regeneration. |
| `src/tracker/tracker-view.js` | Tracker visibility mode. |
| `src/chat/reprocess.js` | Callback bridge for reprocessing chat messages. |

## Extraction and prompts

| File | Responsibility |
| --- | --- |
| `src/tracker/extractor/status-extractor.js` | Public entry point for model extraction. |
| `src/tracker/extractor/status-extractor-schema.js` | Structured extraction schema and unknown speaker classification. |
| `src/tracker/extractor/status-extractor-deltas.js` | Numeric delta eligibility and conversion to stored stat values. |
| `src/tracker/extractor/status-extractor-prompt.js` | Extraction prompt assembly and recent message context. |
| `src/tracker/extractor/status-extractor-prompt-state.js` | Describe current state, collections, and limits for prompts. |
| `src/tracker/extractor/status-extractor-prompt-offstage.js` | Describe locked and offstage characters for prompts. |
| `src/tracker/extractor/status-extractor-request.js` | Send and normalize model extraction responses. |
| `src/tracker/extractor/status-extractor-replies.js` | Apply allowed profile, memory, and goal information from extraction. |
| `src/tracker/extractor/status-extractor-run.js` | Per-message extraction lifecycle and cache invalidation. |
| `src/prompts/prompt-texts.js` | Built-in prompt text and template substitution. |
| `src/prompts/prompt-texts-reader.js` | Reader and status extraction prompt templates. |
| `src/prompts/prompt-texts-other.js` | Other built-in prompt templates. |
| `src/prompts/fill-preset.js` | Automatic character fill stage selection. |
| `src/prompts/prompt-slot.js` | Place writing prompts in SillyTavern's prompt manager. |
| `src/prompts/macros.js` | Expand extension template macros. |
| `src/prompts/narrator-rules.js` | Narrator writing rules. |
| `src/prompts/dialogue-format.js` | Dialogue formatting instructions. |
| `src/prompts/banlist.js` | Banned phrase rules and scan prompts. |

## Characters and story

| File | Responsibility |
| --- | --- |
| `src/characters/characters.js` | Character records, categories, aliases, and chat cast membership. |
| `src/characters/character-repository.js` | Route character reads and writes among chat, world, and library records. |
| `src/characters/character-scope.js` | Visible character selection and pattern signatures. |
| `src/characters/character-transfer.js` | Character transfer file import and export. |
| `src/characters/character-images.js` | Character image folders, listing, and migration. |
| `src/characters/character-image-migration.js` | Copy and migrate images between character folders. |
| `src/characters/character-fill.js` | Audit missing character data and fill profile, stats, and items. |
| `src/characters/character-fill-lore.js` | Fill or generate character lore. |
| `src/characters/default-portraits.js` | Stranger portrait pool and assignments. |
| `src/characters/image-tags.js` | Portrait tag fields and tag lookup. |
| `src/lore/lorebook.js` | Lorebook linking, identity, and synchronization. |
| `src/lore/lorebook-target.js` | Choose and name a chat lorebook for Fill without overwriting an existing book. |
| `src/lore/lore-format.js` | Parse and format active System fields while retaining unknown saved lore lines. |
| `src/lore/lore-sync.js` | Sync NPC fields with the linked lorebook entry. |
| `src/lore/activated-lore.js` | Capture activated lore entries and their characters. |
| `src/story/beats.js` | Segment visible message content into story beats. |
| `src/story/mentions.js` | Detect named character mentions. |
| `src/story/speaker-labels.js` | Normalize and filter speaker names. |
| `src/chat/chat.js` | Decorate messages with portraits, speaker colors, and tracker controls. |
| `src/chat/chat-signature.js` | Compute chat rendering signatures. |
| `src/chat/chat-portraits.js` | Select and inject character portraits. |
| `src/chat/dialogue-line.js` | Recognize plain speaker dialogue lines. |
| `src/chat/chat-speech.js` | Attach portraits to recognized dialogue lines. |
| `src/chat/chat-reprocess.js` | Reprocess message decorations and tracker controls. |
| `src/chat/chat-listing.js` | List chat headers. |
| `src/chat/chat-npc-sources.js` | Identify chat-owned NPC sources and their images. |
| `src/story/history-scan.js` | Scan existing chat for collection state. |
| `src/story/history-notes.js` | Read and remove historical world notes. |
| `src/story/threads.js` | Read archived legacy Threads records. |
| `src/characters/world-character-export.js` | Export world character records. |

## Interface

| File | Responsibility |
| --- | --- |
| `src/tracker/ui/status-ui.js` | Inject and render tracker boxes, plus inline editing. |
| `src/tracker/ui/status-ui-process.js` | Process tracker data on rendered messages. |
| `src/tracker/ui/status-ui-guards.js` | Detect tracker editing and visible message content. |
| `src/tracker/ui/status-ui-hidden.js` | Hide raw status data in message content. |
| `src/tracker/ui/status-ui-box.js` | Build and place tracker boxes. |
| `src/tracker/ui/status-ui-placement.js` | Select the latest visible prose message when image-only messages are present. |
| `src/tracker/ui/status-ui-menu.js` | Tracker menu and add-character controls. |
| `src/tracker/ui/status-ui-template.js` | Assemble tracker HTML. |
| `src/tracker/ui/status-ui-template-core.js` | Render core tracker fields. |
| `src/tracker/ui/status-ui-template-characters.js` | Render character sections in the tracker. |
| `src/tracker/ui/status-ui-edit.js` | Wire inline tracker editing. |
| `src/ui/manage/ui-manage.js` | Management popup and tab routing, including the Player view. |
| `src/ui/api/ui-api.js` | Lore and portrait generation dialogs. |
| `src/ui/api/ui-api-lore.js` | Lore generation dialog workflow. |
| `src/ui/api/ui-api-image.js` | Portrait generation dialog workflow. |
| `src/ui/shared/ui-banlist.js` | Banlist editor. |
| `src/ui/shared/ui-bulk-select.js` | Shared bulk selection controls. |
| `src/ui/characters/ui-cast-panel.js` | Cast membership panel. |
| `src/ui/tracker/ui-change-review.js` | Review proposed model changes. |
| `src/ui/collections/ui-collection.js` | Collection editor and event handlers. |
| `src/ui/settings/ui-connection-profiles.js` | Generation connection picker. |
| `src/ui/characters/ui-fill.js` | Character fill controls. |
| `src/ui/characters/ui-grid-filter.js` | Character grid filtering. |
| `src/ui/hud/ui-hud.js` | Floating HUD, portrait, meters, and drag handling. |
| `src/ui/hud/ui-hud-render.js` | Build and refresh floating HUD content. |
| `src/ui/hud/ui-hud-portrait.js` | HUD portrait loading and sizing. |
| `src/ui/hud/ui-hud-meters.js` | HUD bars, pips, and rings. |
| `src/ui/hud/ui-hud-settings.js` | HUD configuration view. |
| `src/ui/collections/ui-item-library.js` | Master item library. |
| `src/ui/collections/ui-item-library-sections.js` | Item rows, rules, and tombstone sections. |
| `src/ui/story/ui-lorebook-section.js` | Lorebook settings and controls. |
| `src/ui/characters/ui-player-sheet.js` | Player tab view, shared HUD/avatar open action, and inline edits. |
| `src/ui/characters/ui-player-sections.js` | Player sheet content sections. |
| `src/ui/characters/ui-memories.js` | Editable active and archived memory lists on character sheets. |
| `src/ui/characters/ui-portrait.js` | Portrait gallery and lightbox. |
| `src/ui/characters/ui-profile.js` | Active System profile fields and saved legacy field display/editing. |
| `src/ui/tracker/ui-scan-button.js` | History scan trigger. |
| `src/ui/settings/ui-setting-controls.js` | Shared settings form controls. |
| `src/ui/settings/ui-settings-search.js` | Search settings and jump to results. |
| `src/ui/settings/ui-settings-tabs.js` | Public entry point for settings views. |
| `src/ui/settings/ui-settings-appearance.js` | Appearance settings. |
| `src/ui/settings/ui-settings-writing.js` | Writing rule settings. |
| `src/ui/settings/ui-settings-advanced.js` | Advanced settings. |
| `src/ui/settings/ui-settings-defaults.js` | Default behavior settings. |
| `src/ui/settings/ui-settings-generation.js` | Generation settings. |
| `src/ui/settings/ui-settings-generation-helpers.js` | Shared helpers for generation settings. |
| `src/ui/settings/ui-settings-generation-image.js` | Portrait shape and prompt controls for SillyTavern Image Generation. |
| `src/ui/settings/ui-settings-generation-storage.js` | Portrait folder, image discovery, and orphan cleanup controls. |
| `src/ui/shared/ui-shared.js` | Shared UI facade and choice helpers. |
| `src/ui/shared/ui-choice.js` | Shared choice field controls. |
| `src/ui/shared/ui-stats.js` | Stats view. |
| `src/ui/system/ui-system-builder.js` | Public entry point for system schema editor. |
| `src/ui/system/ui-system-profiles.js` | Player and NPC profile field controls in System Builder. |
| `src/ui/system/ui-system-profile-operations.js` | Pure add, rename, order, retire, and restore operations for profile fields. |
| `src/ui/system/ui-system-collections.js` | Collection schema editor. |
| `src/ui/system/ui-collection-fields.js` | Collection field controls and row wiring for the schema editor. |
| `src/ui/system/ui-system-stats.js` | Stat schema editor. |
| `src/ui/system/ui-system-stat-policy.js` | Stat update policy and level-up eligibility controls. |
| `src/ui/system/ui-system-manager.js` | Reusable System manager and archived legacy world controls. |
| `src/ui/shared/ui-template-tidy.js` | Prompt template cleanup UI. |
| `src/ui/shared/ui-theme.js` | Apply themes and portrait/speech display options. |
| `src/ui/story/ui-goals.js` | Current goals editor and read-only legacy Threads archive. |
| `src/ui/tracker/ui-tracker-settings.js` | Tracker settings entry point. |
| `src/ui/tracker/ui-tracker-display-reading.js` | Display and extraction reader controls. |
| `src/ui/tracker/ui-tracker-scan-review.js` | History scan and change review controls. |
| `src/ui/tracker/ui-tracker-cast-recovery.js` | Cast, time, context, recovery, and dashboard controls. |
| `src/ui/tracker/ui-tracker-context.js` | Tracker context report. |
| `src/ui/tracker/ui-tracker-history.js` | History-note fields, current tracker placement, and chat cleanup. |
| `src/ui/tracker/ui-tracker-popups.js` | Advanced tracker and dashboard popups. |
| `src/ui/tracker/ui-tracker-time.js` | Time rule settings. |
| `src/ui/shared/ui-transfer.js` | Import/export dialogs. |
| `src/ui/manage/ui-manage-state.js` | Management popup state and navigation. |
| `src/ui/manage/ui-manage-grid.js` | Character grid assembly and filtering. |
| `src/ui/manage/ui-manage-cards.js` | Character card controls in the management grid. |
| `src/ui/manage/ui-manage-editor.js` | Character editor tabs and form assembly. |
| `src/ui/manage/ui-manage-pictures.js` | Character picture and tag editor. |
| `src/ui/manage/ui-manage-collections.js` | Character collection editor. |
| `src/ui/manage/ui-manage-overrides.js` | Character override and alias editor. |
| `src/ui/manage/ui-manage-transfer.js` | Management popup import/export actions. |
| `src/ui/shared/css-origin.js` | Diagnose CSS visibility and rule origins. |
| `src/ui/shared/template-labels.js` | Find and repair template labels. |
| `style.css` | Manifest CSS entry point; imports the ordered stylesheets below. |
| `styles/01-base.css` | Base layout, controls, and shared visual tokens. |
| `styles/02-themes-a.css` | First group of extension themes. |
| `styles/03-themes-b-chat.css` | Remaining themes and chat decoration. |
| `styles/04-cards-editor.css` | Character cards and editor styling. |
| `styles/05-tracker-review.css` | Tracker and change review styling. |
| `styles/06-meters-hud-player.css` | Stat meters, HUD base, and player sheet. |
| `styles/07-collections-responsive.css` | Collection cards and responsive layouts. |
| `styles/08-collections-readonly.css` | Read-only collection views and portraits. |
| `styles/09-hud-meters-layouts.css` | HUD meters and layout variants. |
| `styles/10-hud-layouts-fill.css` | HUD placement and automatic fill views. |
| `styles/11-character-threads.css` | Character, thread, and settings search views. |
| `styles/12-picture-tags.css` | Picture tag editor and gallery. |
| `styles/13-system-profiles.css` | System profile field Builder controls. |
| `styles/14-goals.css` | Goals editor and archived Threads presentation. |
| `styles/14-memories.css` | Character memory editor and archive presentation. |

## Maintenance notes

`src/tracker/status-logic.js` binds the state providers by name, then freezes the shared
registry. `tests/status-dependencies.mjs` checks that each dependency has one
provider. The registry still resolves cross-module calls at runtime, so changes to
initialization and shared state need care. `normalizeSettings` now sequences focused
migration passes, `generateLoreEntry` separates dialog construction from its async
actions, and `renderEditor` routes among smaller view builders. Their key behavior
paths have regression tests under `tests/`.
