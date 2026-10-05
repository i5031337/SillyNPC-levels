# Chat-owned NPCs and portable characters

NPC ownership is implemented through `src/characters/character-repository.js`.
Cards created with an open chat live in `chatMetadata.sillynpc_npcs`; reusable world
cards live in extension settings. Lookups and writes go through the repository so
Fill, portraits, profile editing, cast controls, and tracker synchronization agree.

Chat NPCs belong to the chat independently of its persona. Bringing a reusable card
into a chat creates an instance. Deleting a chat removes its metadata-owned cards;
portrait files and lorebook entries are separately stored assets and require their
own reference-aware cleanup.

## Transfer contract

Character files use `{format: "sillynpc-characters", version: 2, characters: [...]}`.
They carry identity, aliases, profile prose, template identity, portable lore text,
and Advancement/locked stat values. The serialized stat map retains the field name
`innateStats`. Turn-managed values and adventure holdings reset to destination defaults.
Policy comes from destination definitions, rather than hardcoded stat names.

Local portrait paths and lorebook pointers do not travel in new exports. Older files
containing portraits can still import. Linked lore travels as text and can be recreated
in the destination lorebook. Unknown profile prose is retained when fields are retired.

**Export selected** previews transferable fields. **Export World Characters** scans
chats assigned to the requested System, preserving source chat and NPC IDs so same-name
NPCs are not merged solely by name. Unsaved edits from the currently open chat are
included. System exports contain reusable rules, separately from character files.

## Character UI

The NPC page groups profile description and linked lore under **Description & Lore**;
they remain stored in their respective card and lorebook fields. Clicking an unknown
speaker portrait creates its chat-owned card and starts the selected automatic Fill
preset. The preset can omit portraits, which use a separate generation request.
Fill preserves completed stages when retrying a failed stage. Alias correction remains
available for a speaker who should resolve to an existing NPC.

## Verification boundaries

Ownership and transfer tests cover chat separation, persona switches, repository
routing, policy-based stat transfer, and source identity. Host checks must also verify
speaker creation, Fill retry, lore synchronization, and portrait behavior. Shared
portrait/lorebook asset cleanup is separate from card ownership.
