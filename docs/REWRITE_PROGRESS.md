# Rewrite progress

This is the first implementation slice of `REWRITE_PLAN.md`.

## Implemented

- Phase 0: documented storage boundaries, added synthetic legacy fixtures, inventoried callers of history, Threads, prompt overrides, checkpoints, and the old player popup. Added a host smoke checklist.
- Phase 1: Player renders in the normal extension menu; HUD and persona avatar actions open that tab. The separate player popup shell and styling are removed. Open stat edits commit on tab switch and close.
- Phase 2 foundation: a versioned System definition normalizes old presets into stable field IDs, separate player/NPC profiles, guidance and policies, stats, collections, progression, HUD defaults, and a configurable memory limit. New System exports contain only this reusable definition. Imported legacy worlds are moved to `settings.systemWorldArchive` for recovery; old preset shapes remain readable. A chat can choose a System before its first player message, then is locked to it.
- Player values: stats and collections now start from System defaults; goals and memories have chat-local slots. All four stay in chat metadata under the selected persona. Existing tracker chats missing a player slot can recover legacy values. Persona identity/profile/portrait/lore remain in persona settings. Removed the old global player sync path.
- Portraits: use SillyTavern Image Generation's `/imagine` command and configured provider. Removed direct Gemini image requests, reference-image UI, and backend-specific controls.
- New installs default to automatic application of valid reader changes. Existing saved review choices remain intact.

## Remaining in the plan

- Wire the resolved System profile registry through Fill, editors, lore, reader schema/prompts, transfers, and System Builder. The current runtime still uses fixed profile fields. Complete player/NPC schema editing and retirement without losing unknown card values.
- Implement anchored/replaceable/memory policy enforcement, sourced memory entries, configured Goals, and the latest-turn base/one-step undo. Then retire live Threads, historical replay, checkpoints, and the general prompt editor while preserving old data readers.
- Finish HUD simplification and the remaining docs cleanup after the new state paths are in place.
- Run the interactive checks in `REWRITE_HOST_SMOKE.md` in an authenticated SillyTavern session. The host responded with HTTP 200, but no controllable session was available during this slice.

The legacy System world archive is transitional. Existing System switching still restores archived worlds while the remaining chat ownership migration is pending; it is excluded from new System exports.
