# SillyNPC XP: product spec draft

Status: discussion draft. This describes the desired product, not current behavior.

## Purpose

Make NPCs recognizable in chat and keep a coherent, visible record of the people and world in an ongoing roleplay. A genre System defines the character-sheet format and tracking rules; each chat holds its own cast and story state. The extension should work with SillyTavern's normal message editing and regeneration flows and preserve existing SillyNPC chats and exports.

## Genre Systems and chats

- A reusable System defines player and NPC profile fields, tracked stats and item collections, field guidance, update policy, progression rules, and default HUD presentation. A science-fiction, fantasy, or modern romance System can have a different format.
- A chat selects a System. Its NPC records, player and NPC values, inventory, location, time, and goals remain with that chat rather than being copied into the reusable System definition.
- New characters get that System's profile and tracking fields. Switching a chat to a different System requires an explicit mapping or preview so existing values are not silently lost.
- A System may have different player and NPC schemas; NPC levels are optional even when player progression is enabled.

## Core requirements

### 1. Dialogue and identity

- Recognize named speakers in generated dialogue and visually distinguish their speech.
- Resolve aliases to the intended NPC; handle an unknown speaker without forcing a new card.
- Use a stable color and portrait for each recognized NPC within the relevant chat.
- Let the user correct a mistaken identity or create a chat-owned NPC from a speaker.

### 2. One-click NPC creation

- From a speaker or NPC card, one action starts profile and portrait generation using available story context.
- The resulting card has a name, the selected System's NPC profile fields, a portrait, and a lorebook link where requested.
- Show generation progress and let the user inspect, edit, retry failed parts, or keep completed parts.
- Do not overwrite fields or portraits the user has chosen without an explicit action.

### 3. Turn reader and world state

- After a completed story turn, a background LLM call proposes changes to configured player, NPC, and world fields.
- Supported changes include numeric and text stats, item collections, editable profile/lore fields, time, location, and goals.
- The System defines the fields and collection schemas, with short per-field guidance for the reader. The reader cannot create unconfigured fields silently.
- Each profile field has an update policy: **anchored** (one-click generation may fill an empty value; the turn reader cannot rewrite it), **replaceable** (the reader may propose an evidenced change), or **memory** (the reader may append a distinct, sourced event without rewriting earlier entries). User edits remain possible for every field.
- Appearance and personality default to anchored. Memories default to appendable. The reader may update time, location, inventory, and other turn-state fields under their configured policies.
- Player XP and levels are supported. Story-derived XP awards advance the player consistently and any level bonus follows the selected System's rules. NPC XP and levels are not required.
- Preserve chat and persona ownership: NPCs and world state belong to the chat; player state follows the selected persona according to an explicit rule.
- Show proposed changes and allow correction or rejection before uncertain or consequential changes are committed.
- A reader failure leaves the last committed state intact and can be retried.
- Each failed tracker, level-bonus, or Fill generation step offers a retry from its result. A failed level bonus leaves the XP update unapplied until the full turn succeeds; earlier completed Fill steps remain saved.

### 4. Current-turn consistency

- Save the state immediately before processing the latest assistant turn, including any profile and lore changes that turn may cause.
- When SillyTavern replaces, regenerates, edits, deletes, or switches the latest reply, restore that base and apply only the chosen reply's accepted changes.
- Repeated regeneration or switching between existing replies must not double-apply changes.
- Manual edits made after the turn must survive a reply switch unless the user explicitly undoes them.
- Retain only the history needed for this behavior and a one-step user undo; arbitrary historical replay is not a product requirement.

### 5. HUD and inspection

- Display the current player, relevant NPCs, world time and location, goals, and configured stats/items in a readable HUD.
- Show each NPC's short-term goal and the player's short- and long-term goals when those fields are configured. These are ordinary visible tracked fields, so their usefulness does not depend on a separate Threads panel.
- Put the full player sheet on a **Player** tab in the normal extension menu, reachable even when the HUD is hidden. It shows and edits the selected persona's profile, stats, items, memories, and goals.
- Let the HUD open that same Player view as a shortcut; do not maintain a second player-sheet flow in a separate popup.
- Provide a fuller NPC view for inspecting and manually editing the same state.
- Update after reader results, review decisions, manual edits, chat changes, and reply changes.
- Offer a small set of coherent layouts and appearance controls; every underlying state field need not be shown at once.

### 6. Prompt policy

- Ship maintained prompt templates generated from the configured field and collection definitions, their guidance, current state, and relevant story context.
- System field names, schemas, guidance, and update policies are user-editable. Full prompt-text editing is not required for normal use.
- Keep enough diagnostics to inspect what was sent and returned when extraction fails.
- Decide separately whether an advanced raw-prompt override is worth retaining.

## Open design decisions

1. **Goals and Quests:** Start with visible NPC short-term goals and player short- and long-term goals. Decide later whether a separate structured quest list adds value. The standalone Threads ranking and scan system is not required by this draft.
2. **Profile schema details:** Decide how a user adds, renames, or removes System profile fields and how older lorebook entries map to them. Define whether memory entries have dates, source-message links, limits, and a manual correction flow.
3. **System switching:** Decide whether one chat can change Systems after play starts, and what value-mapping preview it needs. A reusable genre definition and a campaign's cast must remain distinct.
4. **Review policy:** Which changes can apply automatically, and which must wait for approval? The default should be predictable and visible.
5. **Portrait backend:** Keep the current image-generation connections or narrow support to the backend(s) actually used.

## Scope guidance for reevaluation

Keep the existing integration and data readers while replacing large subsystems where the new behavior differs. The clearest candidates to retire, if the decisions above hold, are historical per-message reconstruction, multi-entry undo and checkpoint UI, the separate Threads ranking/scan system, and the general prompt editor. System presets need a redesign so genre schemas include profile fields without bundling a campaign's cast into the reusable definition. Remove each feature only after its remaining callers and saved-data path are accounted for. The one-turn base, chat ownership, lorebook synchronization, player progression, and reader review path remain core.
