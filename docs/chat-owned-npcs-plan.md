# Chat-owned NPCs and portable world characters

Implementation plan for a future development session. Base this work on `xp-progression`.
The separate `xp-level-pr` branch is a focused upstream contribution and has not been
merged into this development branch.

## Decisions

- A newly discovered NPC belongs to the **chat**, independent of the active persona.
  Switching personas in that chat leaves its NPCs and their state alone. Deleting the
  chat deletes its NPC records.
- A Saved System defines the NPC stat fields and their defaults. Each NPC stat definition
  distinguishes **innate** values (for example Strength and Wisdom) from **variable**
  values (for example HP and Level).
- Transferring an NPC to another adventure carries identity, profile, description/lore,
  and innate stat values. Variable stats and adventure inventory start from the
  destination System's defaults. No variable value is silently copied into the new chat.
- Exporting a Saved System's characters includes **all NPCs in all chats assigned to that
  System**, including NPCs that exist only in one chat. It is a character-only export;
  the existing full System export remains available for rules and other world data.
- The NPC page should present Lore and Description as one coherent section rather than
  two competing narratives.
- Clicking an unregistered speaker thumbnail should create its chat-owned card and
  start Fill directly, without opening the card editor or requiring a second Fill click.

## Current code and constraints

- Cards currently live in `getSettings().characters` and are included in Saved System
  world snapshots (`src/characters/characters.js`, `src/tracker/status-logic.js` `captureWorld` and
  `restoreWorld`). This is world ownership, not chat ownership.
- A chat already owns tracker state and cast selection in chat metadata
  (`src/tracker/status-logic.js` and `src/characters/characters.js`). Chats are tagged with their Saved
  System under `sillynpc_system`; persona changes already have their own handling.
- `src/characters/character-transfer.js` can serialize an array of cards, and the character grid
  already offers **Export selected**. `src/ui/system/ui-system-manager.js` exports an entire
  System. Neither command gathers chat-owned NPCs across every chat in a System.
- `index.js` `wireAvatarClicks` currently asks about an unknown speaker, creates a
  world card, then opens the editor. `src/ui/characters/ui-fill.js` shows a separate Fill plan before
  running the stages. `src/ui/characters/ui-profile.js` displays profile text and the linked lore
  entry separately.
- The transfer format deliberately omits portrait image files to avoid very large JSON
  exports. Decide explicitly whether a future portable format should include only the
  selected portrait; do not accidentally make every stored image part of a world export.

## Proposed data model

1. Make a chat metadata collection the canonical store for that chat's NPC cards. Give
   each NPC a stable ID within the chat. Keep the card's identity fields, aliases,
   portrait reference, unified description, and innate stat values there. The chat's
   tracker state keeps variable stats, conditions, and inventory for the NPC instance.
2. Add `persistence: 'innate' | 'variable'` to NPC stat definitions in System Builder.
   The stat definition, rather than a list of hard-coded names, decides what travels.
   Seed obvious shipped fields such as HP and Energy as variable. Existing custom
   fields need a visible migration choice; do not discard their current values while
   assigning a classification.
3. Keep existing world-level cards as reusable source characters during migration.
   New NPCs default to chat ownership. Importing or bringing a reusable character into
   a chat creates a chat-owned instance with innate values copied and variable values
   initialized from that chat's System.
4. Make card lookup and writes go through one ownership-aware interface before moving
   storage. Code currently reads `getSettings().characters` in many places; changing
   only `createCharacter` would produce cards that disappear from lookup, Fill, export,
   or scene synchronization.
5. Ensure a copied chat gets independent NPC records. Avoid a global key based only on
   chat filename, which can change on rename. Storing the records in chat metadata makes
   the chat file the owner. On chat deletion, remove any auxiliary index or owned assets
   only after checking whether another card still references them.

## Implementation sequence

### 1. Stat persistence and transfer contract

- Add the innate/variable control to NPC fields in `src/ui/system/ui-system-builder.js`; normalize
  old System definitions in `src/core/settings.js` and the Saved System load path.
- Define a single function that splits a card's stats by the active System's definitions.
  Use it for initialization, transfer, and export rather than repeating name checks.
- Version the character transfer format. Export innate values and the identity fields;
  import variable stats from destination defaults. Continue reading older character
  files, treating their mixed `statusOverrides` according to the destination definitions.
- Provide a preview or clear summary when migrating existing mixed stat values.

### 2. Chat ownership

- Add the chat card store and ownership-aware card repository. Update speaker matching,
  scene admission, Fill, profile editing, card lookup, cast controls, portraits, and
  `statusOverrides`/`statusCollections` synchronization to use it.
- Keep chat NPCs independent of persona changes. Verify the same name in two chats can
  refer to two independent NPCs. Preserve world-level cards until users deliberately
  instantiate or migrate them; do not assign every legacy card to whichever chat happens
  to be open during an upgrade.
- Verify chat deletion removes the NPC data with the chat. Handle leftover portrait or
  lorebook assets by ownership/reference checks so deleting one chat cannot break a
  character still used elsewhere.

### 3. World character export

- Add **Export World Characters** beside the Saved System controls. Include reusable
  world cards and chat NPCs from every chat tagged with that System, whether or not the
  System or chat is currently open.
- Investigate SillyTavern's chat listing/reading API for collecting chat metadata at
  export time. If that API cannot enumerate the needed metadata, maintain a System-level
  export index of NPC identity and innate values and reconcile it on chat open, save,
  copy, and deletion. A Saved System's existing `world.characters` snapshot alone is
  insufficient once cards are chat-owned.
- Preserve source chat and NPC identity in the export so identically named people in
  different chats remain distinct. Reuse the existing import collision handling; do not
  silently collapse two records because their names match.

### 4. Unified description and one-click Fill

- Give the NPC one canonical narrative description in its card UI. Preserve existing
  profile fields and linked lorebook text during migration; show and edit them together
  without overwriting either source. Decide how the lorebook entry is synchronized so
  edits do not create two divergent descriptions.
- Refactor `src/ui/characters/ui-fill.js` so its Fill pipeline can run from an explicit preset without
  opening the stage-selection popup. The thumbnail click in `index.js` should create the
  chat card and start that pipeline immediately, with progress and a retry path after
  partial failure. Prevent repeated clicks from creating duplicate cards or requests.
- Keep an accessible **Link as alias** action for a speaker who is an existing NPC.
  Make portrait generation configurable in the automatic Fill preset because it may
  have a separate API cost; the chosen preset should be visible in Settings.

## Acceptance checks

- A new NPC appears in one chat, survives a persona switch, and does not appear in an
  unrelated chat. Deleting its chat removes the card; other chats and shared assets stay
  intact.
- An existing world card remains available after upgrade and can be instantiated into
  a chat without losing its text or innate stats.
- Changing a stat's persistence classification affects subsequent transfers as shown
  in the export preview, without erasing stored values.
- Exporting a System with two chats includes NPCs unique to each chat, even while a
  different System is active. Importing that file carries innate values and resets HP,
  Level, conditions, and inventory to destination defaults. Older files still import.
- The first click on an unknown speaker thumbnail creates exactly one chat card and
  starts Fill. An interrupted Fill can be retried without replacing completed fields.
- Lore/Description migration preserves both existing texts and presents one clear place
  to edit the NPC's narrative identity.

## Working order

Start with the ownership-aware repository and persistence contract, then migrate one
read/write path at a time. Add focused tests at each boundary. Keep the original
`xp-progression` history available while developing; do not fold this larger redesign
into `xp-level-pr`.
