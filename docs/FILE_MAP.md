# File map

SillyTavern loads `index.js` and `style.css` from `manifest.json`. The JavaScript entry point imports the feature modules under `src/`.

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
| `tests/status-dependencies.mjs` | Shared status dependency provider contract test. |
| `tests/ui-maintenance.mjs` | Lore generation and character editor routing tests. |

## Runtime and data

| File | Responsibility |
| --- | --- |
| `index.js` | Initialize the extension, register SillyTavern events, and mount settings. |
| `src/entry-message-events.js` | Message, swipe, regeneration, and deletion event handlers. |
| `src/entry-avatar-actions.js` | Character and player avatar click actions. |
| `src/entry-chat-scope.js` | Prompt to scope a chat to its characters. |
| `src/entry-history-notes.js` | Manage copied historical notes on messages. |
| `src/constants.js` | Extension constants, themes, profile schema, and built-in writing/image prompts. |
| `src/constants-base.js` | Base extension, theme, layout, and image constants. |
| `src/constants-profile.js` | Profile field definitions and helpers. |
| `src/constants-prompts.js` | Built-in status and image prompt constants. |
| `src/settings.js` | Default settings, normalization, persistence, and settings transfer. |
| `src/settings-defaults.js` | Default settings catalog. |
| `src/settings-tracker-defaults.js` | Default tracker settings. |
| `src/settings-migration.js` | Normalize settings across versions. |
| `src/settings-base-migration.js` | Normalize common settings and their defaults. |
| `src/settings-store-migration.js` | Normalize stored collections and presets. |
| `src/utils.js` | Image preparation, JSON repair, stat display, downloads, and DOM helpers. |
| `src/utils-media.js` | Image resizing, upload preparation, and media helpers. |
| `src/utils-format.js` | JSON, stat display, text, and DOM formatting helpers. |
| `src/hash.js` | Stable hashes and palette indexes. |
| `src/api.js` | Lore generation and image upload, generation, adoption, and cleanup. |
| `src/api-lore-facts.js` | Assemble lore and tracked fact context. |
| `src/api-lore-generate.js` | Generate and save lore content. |
| `src/api-image-files.js` | Image storage, listing, adoption, and cleanup. |
| `src/api-image-generate.js` | Image model requests and portrait generation. |
| `src/usage.js` | Model usage accounting. |
| `src/tokens.js` | Token budget readout. |
| `src/progression.js` | XP advancement and level bonus calculations. |
| `src/stat-persistence.js` | Rules for NPC stat persistence. |
| `src/status-clock.js` | Story clock parsing and elapsed time. |
| `src/status-rules.js` | Time-based stat rules. |
| `src/status-history.js` | Raw status block preservation and chat overhead measurement. |
| `src/status-logic.js` | Player and NPC state, model updates, cast, items, systems, and checkpoints. |
| `src/status-stat-values.js` | Stat value merging and numeric constraints. |
| `src/status-stat-schema.js` | Stat definition lookup and schema helpers. |
| `src/status-persona-state.js` | Player persona records and activation. |
| `src/status-chat-session.js` | Chat persona/system session lifecycle. |
| `src/status-state-storage.js` | Load, save, and restore status metadata. |
| `src/status-status-summary.js` | Format status summaries. |
| `src/status-scene-prompt.js` | Build scene context and status instructions. |
| `src/status-update-parser.js` | Parse model status update text. |
| `src/status-update-constraints.js` | Validate update values against configured fields. |
| `src/status-apply-update.js` | Apply accepted model updates to state. |
| `src/status-cast-decisions.js` | Record player, excluded, and character cast decisions. |
| `src/status-scene-presence.js` | Reconcile scene presence and active characters. |
| `src/status-collection-updates.js` | Add, remove, and update tracked items. |
| `src/status-collection-schema.js` | Rename collection fields and stat schema references. |
| `src/status-system-presets.js` | Active system and saved system presets. |
| `src/status-checkpoints.js` | Save, restore, and schedule checkpoints. |
| `src/status-diff.js` | Public entry point for state difference and review helpers. |
| `src/status-diff-compare.js` | Compare stats and collections across states. |
| `src/status-diff-review.js` | Attach reasons, partition decisions, and rebuild accepted updates. |
| `src/status-review.js` | Pending changes and item decision rules. |
| `src/status-snapshots.js` | Public entry point for history and swipe state. |
| `src/status-snapshot-records.js` | Store applied changes and thread changes per message. |
| `src/status-snapshot-timeline.js` | Rebuild historical state and player history. |
| `src/status-snapshot-edits.js` | Store and apply manual message edits. |
| `src/status-snapshot-swipe.js` | Align and restore state across swipes. |
| `src/tracker-view.js` | Tracker visibility mode. |
| `src/reprocess.js` | Callback bridge for reprocessing chat messages. |

## Extraction and prompts

| File | Responsibility |
| --- | --- |
| `src/status-extractor.js` | Public entry point for model extraction. |
| `src/status-extractor-schema.js` | Structured extraction schema and unknown speaker classification. |
| `src/status-extractor-prompt.js` | Extraction prompt assembly and recent message context. |
| `src/status-extractor-prompt-state.js` | Describe current state, collections, and limits for prompts. |
| `src/status-extractor-prompt-offstage.js` | Describe locked and offstage characters for prompts. |
| `src/status-extractor-request.js` | Send and normalize model extraction responses. |
| `src/status-extractor-replies.js` | Apply profile and thread information from extraction. |
| `src/status-extractor-run.js` | Per-message extraction lifecycle and cache invalidation. |
| `src/prompts.js` | Prompt definitions and availability. |
| `src/prompt-texts.js` | Editable built-in prompt text and template substitution. |
| `src/prompt-texts-reader.js` | Reader and status extraction prompt templates. |
| `src/prompt-texts-other.js` | Other built-in prompt templates. |
| `src/fill-preset.js` | Automatic character fill stage selection. |
| `src/prompt-slot.js` | Place writing prompts in SillyTavern's prompt manager. |
| `src/macros.js` | Expand extension template macros. |
| `src/narrator-rules.js` | Narrator writing rules. |
| `src/dialogue-format.js` | Dialogue formatting instructions. |
| `src/banlist.js` | Banned phrase rules and scan prompts. |

## Characters and story

| File | Responsibility |
| --- | --- |
| `src/characters.js` | Character records, categories, aliases, and chat cast membership. |
| `src/character-repository.js` | Route character reads and writes among chat, world, and library records. |
| `src/character-scope.js` | Visible character selection and pattern signatures. |
| `src/character-transfer.js` | Character transfer file import and export. |
| `src/character-images.js` | Character image folders, listing, and migration. |
| `src/character-image-migration.js` | Copy and migrate images between character folders. |
| `src/character-fill.js` | Audit missing character data and fill profile, stats, and items. |
| `src/character-fill-lore.js` | Fill or generate character lore. |
| `src/default-portraits.js` | Stranger portrait pool and assignments. |
| `src/image-tags.js` | Portrait tag fields and tag lookup. |
| `src/lorebook.js` | Lorebook linking, identity, and synchronization. |
| `src/activated-lore.js` | Capture activated lore entries and their characters. |
| `src/beats.js` | Segment visible message content into story beats. |
| `src/mentions.js` | Detect named character mentions. |
| `src/speaker-labels.js` | Normalize and filter speaker names. |
| `src/chat.js` | Decorate messages with portraits, speaker colors, and tracker controls. |
| `src/chat-signature.js` | Compute chat rendering signatures. |
| `src/chat-portraits.js` | Select and inject character portraits. |
| `src/chat-speech.js` | Render speaker labels and speech colors. |
| `src/chat-reprocess.js` | Reprocess message decorations and tracker controls. |
| `src/chat-listing.js` | List chat headers. |
| `src/chat-npc-sources.js` | Identify chat-owned NPC sources and their images. |
| `src/history-scan.js` | Scan existing chat for collections and story threads. |
| `src/history-thread-scan.js` | Scan existing chat for story threads. |
| `src/history-notes.js` | Read and remove historical world notes. |
| `src/threads.js` | Story thread lifecycle and ranking. |
| `src/world-character-export.js` | Export world character records. |

## Interface

| File | Responsibility |
| --- | --- |
| `src/status-ui.js` | Inject and render tracker boxes, plus inline editing. |
| `src/status-ui-process.js` | Process tracker data on rendered messages. |
| `src/status-ui-guards.js` | Detect tracker editing and visible message content. |
| `src/status-ui-hidden.js` | Hide raw status data in message content. |
| `src/status-ui-box.js` | Build and place tracker boxes. |
| `src/status-ui-menu.js` | Tracker menu and add-character controls. |
| `src/status-ui-template.js` | Assemble tracker HTML. |
| `src/status-ui-template-core.js` | Render core tracker fields. |
| `src/status-ui-template-characters.js` | Render character sections in the tracker. |
| `src/status-ui-edit.js` | Wire inline tracker editing. |
| `src/ui-manage.js` | Management popup, character grid, editor, and tab routing. |
| `src/ui-api.js` | Lore and portrait generation dialogs. |
| `src/ui-api-lore.js` | Lore generation dialog workflow. |
| `src/ui-api-image.js` | Portrait generation dialog workflow. |
| `src/ui-banlist.js` | Banlist editor. |
| `src/ui-bulk-select.js` | Shared bulk selection controls. |
| `src/ui-cast-panel.js` | Cast membership panel. |
| `src/ui-change-review.js` | Review proposed model changes. |
| `src/ui-collection.js` | Collection editor and event handlers. |
| `src/ui-connection-profiles.js` | Generation connection picker. |
| `src/ui-fill.js` | Character fill controls. |
| `src/ui-grid-filter.js` | Character grid filtering. |
| `src/ui-hud.js` | Floating HUD, portrait, meters, and drag handling. |
| `src/ui-hud-render.js` | Build and refresh floating HUD content. |
| `src/ui-hud-portrait.js` | HUD portrait loading and sizing. |
| `src/ui-hud-meters.js` | HUD bars, pips, and rings. |
| `src/ui-hud-settings.js` | HUD configuration view. |
| `src/ui-item-library.js` | Master item library. |
| `src/ui-item-library-sections.js` | Item rows, rules, and tombstone sections. |
| `src/ui-lorebook-section.js` | Lorebook settings and controls. |
| `src/ui-player-modal.js` | Player sheet modal and inline edits. |
| `src/ui-player-sections.js` | Player sheet content sections. |
| `src/ui-portrait.js` | Portrait gallery and lightbox. |
| `src/ui-profile.js` | Character profile blocks and editor. |
| `src/ui-prompts.js` | Prompt editor and budget view. |
| `src/ui-scan-button.js` | History scan trigger. |
| `src/ui-setting-controls.js` | Shared settings form controls. |
| `src/ui-settings-search.js` | Search settings and jump to results. |
| `src/ui-settings-tabs.js` | Public entry point for settings views. |
| `src/ui-settings-appearance.js` | Appearance settings. |
| `src/ui-settings-writing.js` | Writing rule settings. |
| `src/ui-settings-advanced.js` | Advanced settings. |
| `src/ui-settings-defaults.js` | Default behavior settings. |
| `src/ui-settings-generation.js` | Generation settings. |
| `src/ui-settings-generation-helpers.js` | Shared helpers for generation settings. |
| `src/ui-settings-generation-image.js` | Image backend, model, shape, and prompt controls. |
| `src/ui-settings-generation-storage.js` | Portrait folder, image discovery, and orphan cleanup controls. |
| `src/ui-shared.js` | Shared UI facade and choice helpers. |
| `src/ui-choice.js` | Shared choice field controls. |
| `src/ui-stats.js` | Stats view. |
| `src/ui-system-builder.js` | Public entry point for system schema editor. |
| `src/ui-system-collections.js` | Collection schema editor. |
| `src/ui-collection-fields.js` | Collection field controls and row wiring for the schema editor. |
| `src/ui-system-stats.js` | Stat schema editor. |
| `src/ui-system-manager.js` | System preset manager. |
| `src/ui-template-tidy.js` | Prompt template cleanup UI. |
| `src/ui-theme.js` | Apply themes and portrait/speech display options. |
| `src/ui-threads.js` | Story thread views. |
| `src/ui-tracker-settings.js` | Tracker settings entry point. |
| `src/ui-tracker-display-reading.js` | Display and extraction reader controls. |
| `src/ui-tracker-scan-review.js` | History scan and change review controls. |
| `src/ui-tracker-cast-recovery.js` | Cast, time, context, recovery, and dashboard controls. |
| `src/ui-tracker-context.js` | Tracker context report. |
| `src/ui-tracker-history.js` | History and placement settings. |
| `src/ui-tracker-popups.js` | Advanced tracker and dashboard popups. |
| `src/ui-tracker-time.js` | Time rule settings. |
| `src/ui-transfer.js` | Import/export dialogs. |
| `src/ui-manage-state.js` | Management popup state and navigation. |
| `src/ui-manage-grid.js` | Character grid assembly and filtering. |
| `src/ui-manage-cards.js` | Character card controls in the management grid. |
| `src/ui-manage-editor.js` | Character editor tabs and form assembly. |
| `src/ui-manage-pictures.js` | Character picture and tag editor. |
| `src/ui-manage-collections.js` | Character collection editor. |
| `src/ui-manage-overrides.js` | Character override and alias editor. |
| `src/ui-manage-transfer.js` | Management popup import/export actions. |
| `src/css-origin.js` | Diagnose CSS visibility and rule origins. |
| `src/template-labels.js` | Find and repair template labels. |
| `style.css` | Manifest CSS entry point; imports the ordered stylesheets below. |
| `styles/01-base.css` | Base layout, controls, and shared visual tokens. |
| `styles/02-themes-a.css` | First group of extension themes. |
| `styles/03-themes-b-chat.css` | Remaining themes and chat decoration. |
| `styles/04-cards-editor.css` | Character cards and editor styling. |
| `styles/05-tracker-review.css` | Tracker, history, and change review styling. |
| `styles/06-meters-hud-player.css` | Stat meters, HUD base, and player sheet. |
| `styles/07-collections-responsive.css` | Collection cards and responsive layouts. |
| `styles/08-collections-readonly.css` | Read-only collection views and portraits. |
| `styles/09-hud-meters-layouts.css` | HUD meters and layout variants. |
| `styles/10-hud-layouts-fill.css` | HUD placement and automatic fill views. |
| `styles/11-character-threads.css` | Character, thread, and settings search views. |
| `styles/12-picture-tags.css` | Picture tag editor and gallery. |

## Maintenance notes

`src/status-logic.js` binds the state providers by name, then freezes the shared
registry. `tests/status-dependencies.mjs` checks that each dependency has one
provider. The registry still resolves cross-module calls at runtime, so changes to
initialization and shared state need care. `normalizeSettings` now sequences focused
migration passes, `generateLoreEntry` separates dialog construction from its async
actions, and `renderEditor` routes among smaller view builders. Their key behavior
paths have regression tests under `tests/`.
