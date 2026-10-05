# Player and NPC progression with collection rewards

Status: implementation plan; no progression changes implemented by this document.

## Goal and agreed direction

Support level-ups for both the player and NPCs. Let collections hold earned items,
spells, skills, abilities, or other discrete rewards instead of storing the latest
narrative reward in a single text stat. Keep numeric stat growth available, with an
option to increase several configured stats at every level.

The feature must be general-purpose. Pokémon-style progression is an example of
multi-stat growth, not a special NPC type or a requirement to reproduce Pokémon's
species, nature, IV, EV, or experience formulas.

The user has agreed to:

- A Level-up rewards option on collections, honoring Player/All NPCs/template targets.
- Optional guidance and predefined rewards with required levels.
- Reward proposals through the existing tracker review flow, avoiding duplicates.
- Retaining numeric stat increases alongside collection rewards.
- NPC level-ups and a policy that gives most/all selected stats small increases.

The defaults below are proposed implementation decisions, not additional user commitments.

## Current implementation and constraints

- `src/tracker/progression.js` provides pure `progressXp` and `boostStat` helpers.
  XP rollover currently uses a fixed cap from the XP pool, carries excess XP, and
  supports crossing several levels in one update.
- `src/tracker/status-apply-update.js` rolls over player XP and advances player Level.
  NPC stats currently pass through ordinary update/persistence rules without that rollover.
- `src/tracker/extractor/status-extractor-replies.js` requests one player bonus from
  the reader after a level-up. It can increase one eligible numeric stat or write
  narrative text to the unlocked Level bonus stat. That stat's presence currently
  gates bonus generation, including numeric bonuses.
- `src/tracker/stat-update-policy.js` controls eligible stats and moves the optional
  player bonus into review without delaying earned XP/Level.
- `src/core/system-schema.js` already stores player progression field IDs and partial
  NPC progression settings. Runtime progression still relies on names such as XP/Level.
  Audit schema-to-runtime projection before extending this configuration.
- Collections already support multiple targets, a pinned first-field identifier,
  optional numeric ranges, holder-specific fields, and shared static library fields.
- Reader XP is a positive delta; extraction expands it into an absolute reading.
  Manual edits and saved review rows can contain absolute values. Preserve this boundary.
- Turn pools can grow their maxima. Advancement ratings keep their configured range.
  NPC Advancement fields travel with the character; Turn fields reset for a new adventure.
- Preserve chat/persona ownership, dry-run purity, regeneration, exports, and old reviews.
  No source file should exceed 20 kB. Use focused modules rather than expanding large files.

## Proposed System configuration

### Progression by owner

Configure the player separately and configure NPC progression per template. An NPC
template can opt out even when another template levels up. Resolve XP and Level by
configured field IDs, using existing normalization to initialize older systems.
The runtime must use the same resolved configuration as the editor and prompts.

Each enabled owner configuration selects:

- XP field and Level field, both included in that owner's stat selection.
- Stat growth policy: None, One stat, or All selected stats.
- Eligible numeric stats. Exclude XP, Level, retired/locked fields, and nonnumeric values.
- For All selected stats, the reader chooses an independent integer increase of
  0–3 for each selected stat at each crossed level, informed by the story. Zero
  means no growth; positive increases remain optional review proposals.

Retain the current fixed XP-cap arithmetic for the first implementation. Variable
experience curves and level caps can be separate work; do not conflate them with rewards.

One stat retains the current story-informed selection and small increase, within
the existing allowed range. All selected stats asks the reader for each stat
at every crossed level and caches valid choices, including zero, for retries. Collection rewards are independent of the stat growth policy:
an owner may receive both stat growth and rewards, or rewards without stat growth.

### Collection rewards

Add a collapsed reward section behind a Level-up rewards checkbox. Reuse the
collection's existing targets; do not add a second competing ownership selector.

Support two explicit modes:

- Scheduled: rows containing a required level and an entry using the collection's
  actual field definitions. Every eligible scheduled entry becomes a review proposal
  when its level is crossed. This makes an exact progression outline possible.
- Guided: concise guidance for choosing one suitable entry at each eligible level,
  with an optional interval (default every level). The model fills the collection's
  configured fields, not a free-form reward string.

Use one mode per collection in the initial UI. A scheduled entry is authored in
the System, not inserted into any character's holdings or the Item Library until
accepted. Validate required identifiers, field types, ranges, and level numbers.

Empty schedules or disabled reward sections grant nothing. Empty guidance should
use a general story-appropriate default. If guided selection has no suitable new
reward, allow an explicit no-reward result rather than forcing duplicates.

## Progression and review behavior

1. Resolve the actor and template using existing ownership/identity helpers. New NPC
   initialization is a starting sheet, not evidence of having earned earlier levels.
2. Normalize earned XP using the existing delta boundary, then compute a transition
   from the pre-update state. Produce one transition per actor with old/new level,
   crossed levels, and remainder XP.
3. Derive stat growth and scheduled rewards from those transitions. Guided rewards
   and One stat choices use model selection with validated, owner-specific schemas.
4. Preview and apply use the same transition and arithmetic. A dry run must never
   modify NPC cards, library entries, settings, or chat metadata.
5. Apply XP/Level through the existing review policy. Keep level-derived stat growth
   and collection rewards in review, matching the existing optional bonus behavior.
   If XP/Level is itself held for review, its dependent grants must wait for that
   transition to be accepted. Rejected XP must never leave applied rewards behind.
6. Review rows identify the recipient, crossed level, stat/collection, and reason.
   Numeric growth and collections can coexist without one overwriting the other.
   Keep story-derived changes and level-derived gains distinct when they affect the
   same stat so accepting growth cannot reapply a story change or bypass its review.
7. Resolve proposed numeric gains against the applicable current value at acceptance;
   reject or rebuild stale proposals when their level transition is no longer valid.
   Preserve exact gains and bounds in history and use an explicit provenance record
   rather than inferring a level-up from a label or a stat's changed value.

### Bounds, pools, and multiple levels

- Plain ratings increase within their configured fixed maximum.
- Turn pools increase current and capacity by the growth amount, preserving existing
  depletion. For example, 6/10 with +1 becomes 7/11, not a full heal.
- Respect existing fixed bounds and clarify their interaction with expandable Turn
  pool capacities before implementation; do not silently remove configured limits.
- No automatic revival, cleansing, refilling, or full healing.
- All selected stats chooses independent 0–3 increases per stat per crossed level,
  subject to bounds. One stat chooses
  one increase per crossed level. Scheduled rewards include each crossed threshold;
  guided intervals are evaluated for each crossed level, not just the final level.
- Direct manual edits of Level/XP are edits, not automatic reward triggers. Imported
  sheets, template changes, new NPC initialization, and chat transfers never backfill rewards.

### Idempotency and failure handling

Use stable actor identity plus the tracker message/swipe, crossed level, and grant
identity to associate grants with their originating transition. Integrate with the
existing turn baseline, applied-row history, and replacement-reading flow instead
of creating an unrelated global ledger.

Repeated reads, accepting a row twice, regeneration, and swipes must not double
grant XP, stat growth, or rewards. Regeneration replaces that reading's grants;
undo restores them with the rest of the tracker state. Rejected grants remain rejected
for that reading and should not be silently recreated on retry.

Reward duplicate checks use the configured primary identifier and existing matching
rules, both against holdings and against other proposals in the same reading. By
default, do not increase quantities or overwrite an existing item as a duplicate reward.
Deleting an earned item later must not cause an old scheduled reward to reappear.

Validate generated entries through existing collection normalization and targeting.
Ignore attempts to reward another template or change locked fields. A malformed
guided reply should produce a visible retryable reward failure; do not lose the XP
transition or already validated deterministic proposals, and retry only missing grants.
Apply actor/chat freshness checks after asynchronous selection, as the reader already does.

## Implementation phases

### 1. Configuration and shared progression primitives

- Audit System normalization, projection, export/import, settings migration, NPC
  template selection, and existing review/history storage.
- Introduce one canonical progression configuration for player and templates and
  optional collection reward definitions. Round-trip stable field IDs.
- Add pure actor-independent transition and multi-stat growth helpers, keeping
  `progressXp` semantics and shared numeric bounds.
- Normalize old player bonus candidates to One stat behavior. Disable NPC progression
  by default for existing templates; do not grant anything simply by loading settings.

### 2. Player/NPC XP integration

- Route player and NPC XP through the shared transition logic in preview/application.
- Update extractor schemas, delta expansion, sanitization, and policy checks to allow
  earned NPC XP for enabled templates, while reserving Level for progression.
- Extend separate-reader and inline-story instructions consistently. Disabled templates
  retain ordinary stat behavior without automatic rollover or grants.
- Persist NPC levels and earned growth through the existing character ownership and
  Advancement mechanisms; verify new-adventure/reset behavior does not erase earned
  progression or copy it to an unrelated NPC.

### 3. Stat growth policies

- Add a compact progression editor to the Player and NPC template screens.
- Extend One stat selection to NPCs and remove dependence on a Level bonus text field.
- Implement reader-chosen All selected stats growth with independent 0–3 increases.
- Replace player-only bonus review matching with actor-aware structured grant provenance.
- Integrate grant dependencies, acceptance-time arithmetic, regeneration, and undo.

### 4. Collection reward authoring and generation

- Add the collapsed collection reward controls and field-driven schedule editor.
- Implement scheduled grants first, then guided model selection using the same validated
  collection entry contract. Batch independent actor/level choices where practical;
  do not send one request per stat or schedule entry.
- Enforce targets, identifiers, bounds, duplicate checks, and review dependencies.
- Confirm accepted static fields follow normal Item Library rules and per-holder fields
  remain personal to the recipient.

### 5. Retire the old narrative reward path and finish

- Stop creating or relying on the Level bonus text stat. Preserve existing stored
  text as readable history/data; do not reinterpret it as invented structured items.
- Keep old saved review rows readable through a small normalization boundary rather
  than maintaining two active bonus-generation systems.
- Update prompts, tooltips, the general Collections tip, and `docs/FILE_MAP.md`.
- Keep numeric eligibility controls, but distinguish stat growth from collection rewards
  with clear labels. Hide policy-specific inputs until needed.

Each phase should land with focused tests and leave the extension usable. Do not
enable incomplete reward modes in the editor.

## Verification and acceptance criteria

Run meaningful focused Node tests, then the full suite:

```sh
node --experimental-default-type=module --test tests/*.mjs
```

Cover:

- Player and NPC rollover, exact thresholds, overflow across several levels, invalid
  XP, positive deltas versus absolute review values, configured renamed fields.
- Different NPC templates with different/disabled progression and overlapping
  collection targets; All NPCs plus a template never grants twice.
- None, One stat, and All selected stats; locked/retired/nonnumeric fields, fixed
  bounds, depleted pools, simultaneous story changes, and multi-level gains.
- Scheduled thresholds, guided intervals/no-reward/malformed replies, custom primary
  fields, collection numeric ranges, existing items, duplicate proposals, static fields.
- Initial NPC sheets, manual edits, chat transfer/reset, persona changes, and offstage
  actor resolution without creating unwanted scene presence.
- Held/rejected XP, partially accepted grants, stale rows, pending grants surviving
  reload, retries, double acceptance, regeneration, swipe replacement, and undo.
- Schema/export/import round trips and readable older sheets/reviews without automatic grants.

Verify UI behavior in the running SillyTavern instance, following AGENTS.md. Use
read-only fixtures that restore state, never save test holdings or request models.
Run `python3 tests/ui-smoke.py` and extend relevant fixture checks for the new controls.
Check narrow layouts, collapsed sections, keyboard access, range errors, target
selection, and actual player/NPC reward review rows.

A complete demonstration should show a player and one enabled NPC crossing a level,
another disabled NPC remaining unaffected, several selected stats gaining their
configured small increases, and a correctly targeted collection reward awaiting
review. Accepting, rejecting, and regenerating must behave predictably without duplicates.

## Starting a fresh implementation session

Read this plan, AGENTS.md, and `docs/FILE_MAP.md`, then inspect the current working
tree before editing. Collection targeting, pinned identifiers, numeric ranges, and
System UI improvements were already implemented before this plan; preserve them.
Start with Phase 1 and audit the actual schema/runtime/review paths rather than
assuming the existing partial NPC progression configuration is functional.
