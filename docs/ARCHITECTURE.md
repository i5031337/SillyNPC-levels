# Runtime and storage boundaries

SillyNPC XP recognizes dialogue, manages NPC identities and portraits, and tracks
chat-owned story state. SillyTavern loads `index.js` and `style.css` directly; there
is no build step. [FILE_MAP.md](FILE_MAP.md) locates the implementation.

## Ownership

| Data | Owner |
| --- | --- |
| Reusable System rules | `extension_settings.sillynpc.statusTracker.presets` |
| Reusable character cards and item library | Extension settings |
| NPC instances, cast selection, active System, tracker state | Chat metadata |
| Player identity, profile, portrait, lore link | Persona record in extension settings |
| Player stats, collections, goals, memories | Chat and selected persona |
| Reader proposals, accepted rows, reply-specific reward choices | Message extras and swipe records |

A chat selects its System before its first player message. Started chats keep that
System. Changing persona does not change the chat's NPC ownership. Player values
remain separate for each persona in the chat.

System exports contain a normalized `schemaVersion: 1` rules definition, including
profile catalogs, stat catalogs, NPC templates, collections, progression, goals,
memories, and HUD selections. Local presets also carry projected flat configuration
for runtime consumers. Imports of older Systems keep rules and discard embedded
world characters, persona records, and item libraries. Whole-settings backups and
character-transfer files are separate formats with different import behavior.

## Profiles, goals, and memories

System profile fields have stable IDs and editable labels, guidance, and policy.
Retirement hides a field without discarding its stored prose. Fill and lore generation
seed empty fields; manual edits and explicit regeneration can revise them. The turn
reader currently updates tracked stats, collections, and sourced goals; it does not
update profile fields or append memories. Optional new-NPC profile generation is a
separate request, disabled by default, which preserves existing cards and edits.

Memory lists are manually editable and bounded by the System's configured active
limit, default 50, with older entries archived. Goals have configured player/NPC
fields and sourced set, replacement, and completion proposals. The former Threads
panel, scanning, ranking, injection, and replay paths are removed. Stored old thread
fields do not have a current archive view.

## Current-turn consistency and review

Latest-reply changes use a pre-turn base. Swipe, regeneration, latest-reply editing,
and deletion replace that reply's accepted changes rather than accumulating them.
Manual corrections and one-step undo have separate handling. Arbitrary historical
tracker restoration, multi-entry undo, and System checkpoints are removed.

New installations apply valid reader changes automatically; saved review preferences
remain effective. Level-derived stat growth and collection rewards remain review
proposals and depend on their originating XP transition. See
[level-up-rewards-plan.md](level-up-rewards-plan.md) for the progression contract.

The Player tab and HUD show the same current state. The HUD opens the menu's Player
tab. Portrait generation uses SillyTavern Image Generation's `/imagine` provider.
Maintained prompts use the active System's schema; the general raw-prompt editor is
removed, while extraction diagnostics remain available.

## Verification

Run `node --experimental-default-type=module --test tests/*.mjs` for state, schema,
request, progression, and review checks. Browser checks require a running local
SillyTavern instance; `python3 tests/ui-smoke.py` is read-only. Additional UI fixtures
restore temporary state and avoid saved test data or model requests.

[REWRITE_HOST_SMOKE.md](REWRITE_HOST_SMOKE.md) preserves the dated user-reported host
results and remaining manual checks. Mocked generator checks establish workflow and
isolation, not local-model quality; evaluate the selected model separately.
