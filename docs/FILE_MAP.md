# File map

SillyTavern loads `index.js` and `style.css` from `manifest.json`. The JavaScript entry point imports the feature modules under `src/`.

## Source directories

| Directory | Responsibility |
| --- | --- |
| `src/entry/` | SillyTavern event and avatar handlers. |
| `src/core/` | Constants, settings, System schemas, active profile fields, memories, migrations, and shared utilities. |
| `src/api/` | Lore and image generation and file operations. |
| `src/generation/` | Staged System generation, canonical schema fragments, validation, requests, and isolated drafts. |
| `src/characters/` | Character records, ownership, portraits, and transfer. |
| `src/chat/` | Chat ownership, message decoration, and reprocessing. |
| `src/lore/` | Lorebook entries and synchronization. |
| `src/story/` | Story beats, mentions, and collection scans. |
| `src/prompts/` | Built-in prompt templates, formatting rules, and prompt placement. |
| `src/tracker/` | Current state, progression, memories, updates, and review; `extractor/`, `snapshots/`, and `ui/` hold focused parts. |
| `src/ui/` | Management, HUD, settings, character, collection, system, tracker, API, and story views. |

## Project files

| File | Responsibility |
| --- | --- |
| `manifest.json` | SillyTavern extension metadata, entry points, and generation interceptor. |
| `index.html` | Settings panel markup. |
| `manage.html` | Management popup markup. |
| `README.md` | Installation, features, and usage documentation. |
| `LICENSE` | Project license. |
| `docs/chat-owned-npcs-plan.md` | Chat ownership and portable character contract. |
| `docs/FILE_MAP.md` | This source map. |
| `docs/ARCHITECTURE.md` | Current storage ownership, reader behavior, review, and verification boundaries. |
| `docs/REWRITE_HOST_SMOKE.md` | Dated user-reported host results and remaining manual checks. |
| `docs/level-up-rewards-plan.md` | Implemented progression/reward contract and verification criteria. |
| `docs/system-generation-plan.md` | Implemented staged System generator design, verification criteria, and schema simplification candidates. |
| `img/SillyNPCLogo.jpg` | Extension logo. |
| `img/charactersexmp.png`, `img/charcterexmp.png`, `img/chatexmp.png` | Character and chat screenshots in the README. |
| `img/floathudbar.png`, `img/floathudcircle.png`, `img/playerexmp.png` | HUD and player screenshots in the README. |
| `img/stats.png`, `img/styleexmp.png` | Stats and appearance screenshots in the README. |
| `tests/character-scope.mjs` | Character visibility and pattern tests. |
| `tests/chat-npc-sources.mjs` | Chat NPC source routing tests. |
| `tests/fill-preset.mjs` | Automatic fill stage tests. |
| `tests/lore-entry-store.mjs` | Concurrent lore creation, ownership, and entry reuse tests. |
| `tests/ui-audit-followup.py` | Unsaved live checks for editable Time and scan overflow before requests. |
| `tests/status-extractor-request.mjs` | Mocked reader/scan routing and visible fallback warnings. |
| `tests/profile-lore-storage.mjs` | Player lore persistence and tracker-only scene context tests. |
| `tests/progression.mjs` | XP advancement tests. |
| `tests/level-grants.mjs`, `tests/level-grant-review.mjs` | Actor-specific grant generation, bounds, dependencies, and atomic review acceptance. |
| `tests/level-reading-retry.mjs`, `tests/inline-level-review.mjs` | Missing-choice retries, freshness, and inline reading replacement. |
| `tests/collection-preview-purity.mjs` | Verify that previews never create library entries or mutate tombstones. |
| `tests/ui-pool-readings.py` | Individual NPC pool/Level initialization, updates over plain saved values, live capacity, and tracker rendering. |
| `tests/ui-level-rewards.py`, `tests/ui-progression-smoke.py` | Unsaved live Firefox fixtures for rewards, review dependencies, and Player/NPC progression controls. |
| `tests/collection-rewards.mjs` | Reward field validation, schedules, intervals, targets, duplicate prevention, and rename stability. |
| `tests/stat-settings-simplification.mjs` | Independent reader locking, carryover, growth, and premise schema contract. |
| `tests/stat-persistence.mjs` | NPC persistence rule tests. |
| `tests/ui-npc-templates.py` | Temporary, unsaved Firefox fixtures for template controls, profile fields, reader guidance, and tracker rendering. |
| `tests/ui_webdriver.py` | Shared Firefox session and guaranteed driver cleanup. |
| `tests/history-scan.mjs` | Preserve NPC template assignments through scan filtering and multi-pass merging. |
| `tests/ui-enable-switch.py` | Unsaved live checks for both master controls, synchronization, disabled reader, and UI cleanup. |
| `tests/ui-smoke.py` | Read-only headless Firefox check of the live System Builder. |
| `tests/status-apply-update.mjs` | Tracker update, dry-run, and no-chat behavior tests. |
| `tests/settings-migration.mjs` | Settings import repair and version-gated HUD migration tests. |
| `tests/system-schema.mjs` | System definition normalization and legacy import tests. |
| `tests/system-profile-builder.mjs` | System profile field edit operations. |
| `tests/player-chat-ownership.mjs` | Persona identity and chat-local player state boundaries. |
| `tests/profile-memories.mjs` | Profile memory list normalization and capacity behavior. |
| `tests/profile-memories-ui.mjs`, `tests/npc-memories.mjs` | Player/NPC memory display and persistence behavior. |
| `tests/turn-delta.mjs` | Current turn change reversal and rebase behavior. |
| `tests/status-dependencies.mjs` | Shared status dependency provider contract test. |
| `tests/ui-chat-boundaries.mjs` | Chat-switch confirmation guards and bulk deletion selection snapshots. |
| `tests/world-character-export.mjs` | Inactive System export rules and reusable/chat NPC inclusion. |
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
| `src/core/constants-profile.js` | Built-in player and NPC profile fields and defaults. |
| `src/core/npc-templates.js` | Resolve NPC templates and their selected stats and profile fields; compact reader assignment guidance. |
| `src/core/profile-fields.js` | Resolve the active System's player and NPC fields, with built-in defaults. |
| `src/core/profile-memories.js` | Normalize and edit bounded character memory lists. |
| `src/core/constants-prompts.js` | Built-in status and image prompt constants. |
| `src/core/settings.js` | Default settings, normalization, persistence, and settings transfer. |
| `src/core/settings-defaults.js` | Default settings catalog. |
| `src/prompts/default-prompt-texts.js` | Built-in lore prompt defaults. |
| `src/core/settings-tracker-defaults.js` | Default tracker settings. |
| `src/core/settings-migration.js` | Normalize settings across versions. |
| `src/core/settings-base-migration.js` | Normalize common settings and their defaults. |
| `src/core/settings-store-migration.js` | Normalize stored collections and presets. |
| `src/generation/contracts.js` | Canonical generation schema fragments and response/count limits. |
| `src/generation/validate-shape.js` | Strict provider-compatible shape checks and complete JSON extraction. |
| `src/generation/validate-definition.js` | Pure semantic validation before and after canonical normalization. |
| `src/generation/planning-prompt.js` | Dedicated planning instructions and a valid example with scoped field-name references. |
| `src/generation/plan.js` | Manifest validation, deterministic ID allocation, and empty canonical draft. |
| `src/generation/stages.js` | Catalog/rule, collection, and reward requests, fixed-ID coverage checks, and local display defaults. |
| `src/generation/catalog-rules.js` | Joint stat/progression response contracts, validation, and atomic application for each catalog. |
| `src/generation/stage-request.js` | Section-specific context and instructions, with schemas restricted to allocated IDs and object counts. |
| `src/generation/generate-system.js` | Sequential generation, bounded repair, retry, cancellation, progress, and assembly. |
| `src/generation/request.js` | Captured reader connection adapter and usage reporting without connection fallback. |
| `src/generation/draft-context.js` | Isolated Builder projection, draft capture, and local rename callbacks. |
| `src/core/system-schema.js` | Versioned reusable System definitions, profile policy, and bounded legacy preset normalization. |
| `src/core/progression-config.js` | Canonical player and per-template progression configuration and configured stat resolution. |
| `src/core/collection-rewards.js` | Pure collection reward normalization, typed entries, schedules, guided intervals, targeting, and duplicate checks. |
| `src/core/utils.js` | Image preparation, JSON repair, stat display, downloads, and DOM helpers. |
| `src/core/utils-media.js` | Image resizing, upload preparation, and media helpers. |
| `src/core/utils-format.js` | JSON, stat display, text, and DOM formatting helpers. |
| `src/core/hash.js` | Stable hashes and palette indexes. |
| `src/api/api.js` | Lore generation and image upload, generation, adoption, and cleanup. |
| `src/api/api-connection-profile.js` | Request-local Additional Parameters from the Custom connection profile's completion preset; included YAML takes precedence over standard parameters. |
| `src/api/api-lore-facts.js` | Assemble lore and tracked fact context. |
| `src/api/api-lore-generate.js` | Generate and save lore content. |
| `src/api/api-image-items.js` | Select collection items for portrait prompts. |
| `src/api/api-image-files.js` | Image storage, listing, adoption, and cleanup. |
| `src/api/api-image-generate.js` | Portrait prompt assembly and SillyTavern Image Generation `/imagine` call. |
| `src/core/usage.js` | Model usage accounting. |
| `src/core/tokens.js` | Token budget readout. |
| `src/tracker/progression.js` | XP transitions and bounded stat growth, including multiple crossed levels. |
| `src/tracker/level-stat-points.js` | Numeric point capacity, allocation with replacement, and manual spending validation. |
| `src/ui/tracker/ui-point-allocation.js` | Random allocation summaries and manual controls for pending point budgets. |
| `src/tracker/progression-fields.js` | Resolve actor progression and reserve configured XP and Level fields in tracker updates. |
| `src/tracker/extractor/status-level-grants.js` | Code-owned numeric point budgets and guided collection selection alongside scheduled rewards. |
| `src/tracker/level-grant-review.js` | Structured grant provenance, XP dependencies, freshness, and acceptance-time grant arithmetic. |
| `src/tracker/manual-level-up-logic.js`, `src/tracker/manual-level-ups.js` | Explicit NPC level advances and chat-owned reward reviews, with runtime bindings. |
| `src/ui/characters/ui-manual-level-up.js` | Card Edit button and pending manual level-up reward controls. |
| `tests/manual-level-ups.mjs`, `tests/ui-manual-level-ups.py` | Explicit level-up lifecycle, generic pool growth, persistence, context guards, and live card review checks. |
| `src/tracker/numeric-stat-bounds.js` | Enforce numeric minimums and pool ceilings. |
| `src/tracker/stat-prompt-definitions.js` | Format stat purposes and rules for reader and inline prompts. |
| `src/tracker/stat-persistence.js` | Rules for NPC stat persistence. |
| `src/tracker/stat-update-policy.js` | Reader locking and migration of retired stat policies. |
| `src/tracker/status-history.js` | Raw status block preservation and chat overhead measurement. |
| `src/tracker/status-logic.js` | Player and NPC state, model updates, cast, items, and Systems. |
| `src/tracker/status-stat-values.js` | Stat value merging and model update sanitization. |
| `src/tracker/status-stat-schema.js` | Stat definition lookup and schema helpers. |
| `src/tracker/status-persona-state.js` | Reusable persona identity/profile and chat-local player stats, collections, and memories. |
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
| `src/tracker/status-system-presets.js` | Active System, reusable definitions, chat locking, and System import. |
| `src/tracker/npc-memories.js` | Store NPC memories in chat-owned or reusable character records. |
| `src/memory/memory-batch.js`, `memory-prompt.js` | Bound transcript batches, validate sourced NPC additions, and build the separate memory request. |
| `src/memory/memory-service.js`, `memory-reader.js` | Persist reading progress, guard asynchronous requests, schedule occasional reads, and invalidate changed sources. |
| `src/memory/memory-review.js` | Match memory review decisions and apply accepted additions to chat-local storage. |
| `src/ui/tracker/ui-memory-button.js` | Separate on-demand memory reader control on the send bar. |
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
| `src/tracker/extractor/status-extractor-run.js` | Per-message extraction lifecycle and cache invalidation. |
| `src/tracker/extractor/status-level-reading.js` | Swipe-specific choice cache, decision retention, and missing-reward retries. |
| `src/tracker/extractor/status-inline-grants.js` | Inline XP delta conversion, review, and replacement-reading orchestration. |
| `src/tracker/extractor/status-npc-profiles.js` | Optional profile generation for newly discovered reader NPCs, with chat and reply guards. |
| `src/prompts/prompt-texts.js` | Built-in prompt text and template substitution. |
| `src/prompts/prompt-texts-reader.js` | Reader and status extraction prompt templates. |
| `src/prompts/prompt-texts-other.js` | Other built-in prompt templates. |
| `src/prompts/fill-preset.js` | Automatic character fill stage selection. |
| `src/prompts/prompt-slot.js` | Place writing prompts in SillyTavern's prompt manager. |
| `src/prompts/macros.js` | Expand extension template macros. |
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
| `src/lore/lore-entries.js` | Create or reuse lore entries for player and NPC identities. |
| `src/lore/lore-entry-store.js` | Serialize entry allocation and reuse ownership markers. |
| `src/lore/lorebook-target.js` | Choose and name a chat lorebook for Fill without overwriting an existing book. |
| `src/lore/lore-format.js` | Parse and format active System fields while retaining unknown saved lore lines. |
| `src/lore/lore-sync.js` | Save player and NPC profile fields to lore, creating a link when needed. |
| `src/entry/entry-enabled.js` | Apply the master switch, synchronize both controls, clear prompts and refresh runtime UI. |
| `src/entry/entry-profile-lore.js` | Sync existing active profiles on startup, chat changes, and persona changes. |
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
| `src/ui/settings/ui-setting-help.js` | Hover, focus, and tap help hints for settings controls. |
| `src/ui/settings/ui-settings-details.js` | Group less-used settings in disclosures. |
| `src/ui/settings/ui-settings-search.js` | Search settings and jump to results. |
| `src/ui/settings/ui-settings-tabs.js` | Public entry point for settings views. |
| `src/ui/settings/ui-settings-appearance.js` | Appearance settings. |
| `src/ui/settings/ui-settings-writing.js` | Writing rule settings. |
| `src/ui/settings/ui-settings-advanced.js` | Advanced settings. |
| `src/ui/settings/ui-settings-defaults.js` | Default behavior settings. |
| `src/ui/settings/ui-settings-generation.js` | Separate Lorebook and Images settings views. |
| `src/ui/settings/ui-settings-generation-helpers.js` | Shared helpers for generation settings. |
| `src/ui/settings/ui-settings-generation-image.js` | Portrait shape and prompt controls for SillyTavern Image Generation. |
| `src/ui/settings/ui-settings-generation-storage.js` | Portrait folder, image discovery, and orphan cleanup controls. |
| `src/ui/shared/ui-shared.js` | Shared UI facade and choice helpers. |
| `src/ui/shared/ui-choice.js` | Shared choice field controls. |
| `src/ui/shared/ui-stats.js` | Stats view. |
| `src/ui/system/ui-npc-templates.js` | Edit reusable NPC templates and shared field selections. |
| `src/ui/characters/ui-npc-template.js` | Choose or correct a character’s NPC template. |
| `tests/image-prompt.mjs`, `tests/image-description.mjs` | Portrait prompt preview/editing, selected profile fields, and image collection inputs. |
| `tests/ui-image-generation.py` | Unsaved live portrait prompt and profile image checkbox checks, without image requests. |
| `tests/npc-templates.mjs` | Template normalization, assignment, validation, review, and scene return tests. |
| `src/ui/system/ui-system-builder.js` | Public entry point for system schema editor. |
| `src/ui/system/ui-system-profiles.js` | Player and NPC profile field controls in System Builder. |
| `src/ui/system/ui-system-profile-operations.js` | Pure add, rename, order, retire, and restore operations for profile fields. |
| `src/ui/system/ui-system-collections.js` | Collection schema editor, including NPC template targets. |
| `src/ui/system/ui-collection-rewards.js` | Collapsed Level-up rewards controls with field-driven schedules and guided selection settings. |
| `src/ui/system/ui-system-progression.js` | Player and NPC template XP/Level selection, points per level, random/manual assignment, and eligible stats. |
| `src/ui/system/ui-collection-targets.js` | Collection target checkboxes for player and NPC template combinations. |
| `src/core/collection-targets.js` | Shared collection targeting rules for sheets, prompts, and updates. |
| `tests/collection-targets.mjs` | Template target normalization and update boundary tests. |
| `src/ui/system/ui-collection-fields.js` | Collection field controls with a pinned first identifier. |
| `src/ui/system/ui-system-range.js` | Inline validation of optional minimum and maximum values in Systems. |
| `src/core/collection-fields.js` | Require one collection identifier and preserve it during field edits. |
| `src/ui/system/ui-system-stats.js` | Stat schema editor. |
| `src/ui/system/ui-system-stat-policy.js` | Stat update policy and level-up eligibility controls. |
| `src/ui/system/ui-system-generation.js` | Premise form, staged progress/retry, draft summary/editing, and validated save-as-new. |
| `src/ui/system/ui-system-context.js` | Explicit live Builder data/save/rename callbacks; draft contexts use the same interface. |
| `src/ui/system/ui-draft-details.js` | Draft description and display choices outside the Builder tabs. |
| `tests/system-generation-planning.mjs` | Regression for Gemma counter defaults, missing counters, and cross-scope template selections. |
| `tests/system-generation.mjs`, `tests/system-generation-request.mjs` | Staged contracts, semantic corruption, limits, retries, cancellation, requests, and fixture progression. |
| `tests/ui-system-generation.py` | Mocked, unsaved Firefox generator workflow and live-state isolation checks. |
| `tests/fixtures/generated-expedition-system.json` | Canonical generated example with targeted progression and scheduled technique rewards. |
| `src/ui/system/ui-system-manager.js` | Reusable System manager, import, export, and selection. |
| `src/ui/shared/ui-template-tidy.js` | Prompt template cleanup UI. |
| `src/ui/shared/ui-theme.js` | Apply themes and portrait/speech display options. |
| `src/ui/tracker/ui-tracker-settings.js` | Tracker settings entry point. |
| `src/ui/tracker/ui-tracker-display-reading.js` | Display and extraction reader controls. |
| `src/ui/tracker/ui-tracker-scan-review.js` | History scan and change review controls. |
| `src/ui/tracker/ui-tracker-tools.js` | Context, cleanup, and dashboard controls. |
| `src/ui/tracker/ui-tracker-context.js` | Tracker context report. |
| `src/ui/tracker/ui-tracker-history.js` | History-note fields, current tracker placement, and chat cleanup. |
| `src/ui/tracker/ui-tracker-popups.js` | Advanced tracker and dashboard popups. |
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
| `styles/11-character-sheets.css` | Character sheets and related settings views. |
| `styles/12-picture-tags.css` | Picture tag editor and gallery. |
| `styles/13-system-profiles.css` | System profile field Builder controls. |
| `styles/14-memories.css` | Character memory editor and archive presentation. |
| `styles/15-setting-help.css` | Settings help icons and popover styling. |

## Maintenance notes

`src/tracker/status-logic.js` binds the state providers by name, then freezes the shared
registry. `tests/status-dependencies.mjs` checks that each dependency has one
provider. The registry still resolves cross-module calls at runtime, so changes to
initialization and shared state need care. `normalizeSettings` sequences focused
migration passes, `generateLoreEntry` separates dialog construction from its async
actions, and `renderEditor` routes among smaller view builders. Their key behavior
paths have regression tests under `tests/`.
