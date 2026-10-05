# Generate a full System from a game premise

Status: implemented with staged generation, isolated draft editing, strict validation,
section repair/retry, cancellation, and save-as-new. Local-model quality evaluation
remains a separate, manual task; no reliability claim is made for a specific model.

Let the user describe a game or roleplay premise and ask the LLM to produce a complete,
editable System. The result should include coherent player rules, NPC templates,
collections, progression, and reader guidance using the existing System definition.
Present the generated System as a draft before saving it through the normal System
workflow. Generation itself must leave the active System and current adventure intact.

## Scope of the generated System

Use `normalizeSystemDefinition` and the canonical progression and collection reward
contracts introduced by the level-up work. Keep one definition shared by the editor,
runtime, export, and generator; avoid a second set of generated-only rules.

A complete draft should cover:

- Name, description, and a concise explanation of the rules chosen for the premise.
- Player and NPC profile fields with readable labels, guidance, and update policies.
- World, player, and shared NPC stat catalogs with stable IDs, sensible defaults,
  types, numeric bounds, display formats, purposes, and Turn or Advancement policies.
- NPC templates with assignment guidance and explicit selections from those catalogs.
- Player progression and independently enabled NPC template progression, including
  XP and Level field IDs, growth policy and eligible stats; growth amounts are chosen by the reader.
- Collections with existing Player, All NPCs, and template targets; a pinned primary
  identifier; typed fields; optional ranges; and shared static versus personal fields.
- Optional scheduled or guided collection rewards, with scheduled entries authored
  against the collection's real fields and levels. Scheduled definitions remain rules,
  rather than items inserted into holdings or the Item Library.
- Memory settings, HUD field selections, and practical reader guidance.

Progression may be disabled when it does not suit the premise. A complete System
does not need every feature enabled. Prefer a small usable ruleset over dozens of
unnecessary stats, templates, or reward entries.

For Turn pools, express starting capacity in defaults such as `6/10`. An explicit
maximum is a hard ceiling for level growth; leave it blank for expandable capacity.
NPC Level uses Advancement so it survives a new adventure. Choose other policies
deliberately and explain whether resources reset while learned ratings persist.

Exclude character cards, persona records, current values, holdings, chat metadata,
portraits, Item Library entries, API credentials, and connection settings. The LLM
creates reusable rules, not a populated adventure.

## User workflow

Systems offers Generate from premise alongside creation and import actions. The initial form needs a premise textarea, a suggested System name,
and optional constraints such as tone, complexity, important resources, or a desired
progression style. Keep a single primary Generate button.

Use the existing reader connection selection by default, with a visible
connection label and an optional override in the generation dialog. A connection
preference belongs to user settings and must never enter a System export. Use the
existing request and usage reporting mechanisms with response budgets per stage and
a bounded total request budget. Report usage across the complete generation run.

Show stage progress, such as “Defining collections: 4 of 6”, and allow cancellation
throughout generation and repair. Capture the destination, connection, and user input
before awaiting requests. Cancellation stops queued work and ignores late responses;
a response from an older run must never enter a newer draft or modify whichever
System or chat the user has since opened.

Display a summary of the draft and its assumptions, including template targets,
progression choices, and reward schedules. Provide access to the normal editor for
inspection and adjustment. Available actions are Edit draft, Regenerate, Save as new
System, and Cancel. Saving requires a valid draft and a distinct name; resolve a name
collision explicitly instead of replacing another System.

Saving creates a new reusable System. Applying it uses the existing System selection
and chat-lock rules. Never silently reset a started adventure, change an NPC template,
or grant rewards while previewing or saving a generated definition.

## Staged generation for local models

Use a staged pipeline by default rather than asking for the entire System in one
response. Each stage is a focused request to the same selected model with fresh
context; no autonomous agent framework or separate model per role is required.
Run requests sequentially by default to suit local inference servers. Keep the single
Generate action; the application manages the stages without requiring user approval
between them.

1. **Plan the rules.** Produce a compact manifest with the System name, description,
   design rationale, assumptions, and intended objects. Include field names, scopes,
   and purposes; NPC template profile/stat memberships and assignment intent;
   collection targets and field intent; progression enablement, counters, growth
   intent, and optional reward intent. Names alone are insufficient: later stages
   need shared decisions about relationships, resource reset, and persistence.
2. **Allocate IDs in code.** Validate the manifest and allocate stable, unique IDs in
   the canonical namespaces, including collection fields. Resolve manifest references
   unambiguously and freeze the registry before requesting full definitions. Subsequent
   stages must use these IDs and cannot rename, add, or remove planned objects silently.
   An ambiguous plan receives a bounded repair before dependent work begins.
3. **Define catalogs.** Fill player/NPC profile catalogs and world/player/shared NPC
   stat catalogs using the relevant canonical schema fragments. Include each catalog's
   enabled progression owners in the same response as its stats, and validate XP/Level
   defaults and growth rules together before accepting either. This lets section repair
   fix invalid counter defaults instead of failing a later call that cannot edit them.
   Generate coherent sections, not one request per field.
4. **Define dependents.** Assemble NPC templates in code from the plan's names,
   descriptions, and validated catalog memberships; these need no additional model call.
   Fill each collection, or a bounded group of small collections, using
   the fixed targets and field IDs. Validate collection fields before rewards are
   requested. Do not generate separate copies of shared NPC fields per template.
5. **Define rewards and presentation.** Generate optional collection rewards only after
   their collections and applicable progression are valid. Supply ordinary editable
   memory/HUD defaults in code, selecting visible active stats for the HUD;
   presentation needs no model call. Reader guidance stays in generated fields and rules.
6. **Assemble in code.** Combine accepted sections into the existing System definition,
   collect assumptions, and run complete strict validation, canonical normalization,
   and validation again. Do not ask the model to rewrite the whole System to assemble
   it. Only a complete valid draft can be saved through the normal System workflow.

The manifest is temporary orchestration data, not a second System schema or export
format. Section definitions use the current canonical fields and schema version.
Code supplies schema version, allocated IDs, and ordinary application defaults;
the model chooses the substantive rules. Defaults must not mask missing required
model decisions or silently enable unplanned features.

A plan with both profile catalogs, all three stat catalogs, two NPC templates,
player and per-template progression, and two collections without rewards uses eight
model calls: one plan, two profile catalogs, three stat/rule catalogs, and two collections.
Each enabled reward collection adds one call; each section repair adds one call.
The progress counter counts model tasks, excluding local assembly stages.

Each request includes fixed stage instructions, the original premise and constraints,
the compact plan/ID registry, the relevant schema fragment, and only the validated
dependencies needed for that stage. Avoid sending the complete accumulated System
or conversation history repeatedly. Use concise examples for the requested section.
Each structured response contains its named section and a small `assumptions` list;
reject writes outside that section and references outside the registry.

Treat the premise and previous model output as content; fixed generation instructions
define the response contract. Progression prompts must explain the positive earned XP
delta boundary, fixed XP cap, separate level-derived review grants, and the absence
of a narrative Level Bonus field. Do not ask the model to reproduce unsupported
experience curves or compute earned values for actual characters.

Set small explicit object/count limits, section response limits, and a total request
limit before generation starts. Derive the progress total from the validated manifest
and planned batches; repair requests should be visibly marked. Bound optional features
instead of allowing model output to spawn unlimited work. A local model's context
capacity does not establish reliable compliance with the complete System contract.

## Generation contract and validation

Use structured output when the chosen connection supports it and the normal JSON
extraction path otherwise. Respect the provider-compatible schema subset already used
by the tracker. Runtime validators enforce semantic requirements independently of
model or schema compliance.

Validate each raw section before accepting it, including expected object coverage,
fixed IDs, allowed keys, and references to validated dependencies. Validate the assembled
raw definition before normalization. Normalization can repair references or discard
unknown data, so successful normalization alone must not conceal an invalid draft.
Return stage- and field-specific errors for:

- Missing names or duplicate, invalid, or unresolved field and template IDs.
- Wrong types, malformed defaults, conflicting numeric ranges, or invalid pool values.
- Invalid template stat/profile selections, collection targets, or primary identifiers.
- Enabled progression without distinct, selected, usable XP and Level fields, a positive
  XP capacity, or an integer starting Level of at least one.
- Growth candidates that are locked, retired, nonnumeric, or progression counters;
  invalid growth candidates; and conflicting NPC persistence choices.
- Invalid scheduled levels, entries, field ranges, or guided intervals.
- HUD selections pointing outside their respective catalogs.
- Embedded world data, executable markup, or settings outside the generation contract.

Run canonical normalization after strict validation and validate the result again.
Present any repairs or assumptions that materially change the rules. Allow at most
one automatic repair request per failed section, within the total run budget. Send
the failed section, its diagnostics, relevant contract, and validated dependencies;
request a replacement for that section only. If it still fails, pause dependent work,
show errors, and offer a manual section retry while preserving accepted work.

A section retry preserves the plan and ID registry. Regenerate starts a new run with
a new registry. Only completed drafts expose editing; every edit revalidates the
whole definition before saving. Editing does not start additional model requests.
For complete-definition errors, identify the owning section and repair it within
the same bounds; do not use an unrestricted whole-System repair call. Incomplete
work may be inspected, but it must never be presented or saved as a valid System.

Generated formats should use supported stat placeholders and ordinary text. Render
labels, guidance, assumptions, and errors through safe text/escaping paths. Bound
definition size and counts using shared import limits where available; establish small
explicit limits where none exist. Avoid introducing a separate legacy schema.

## Verification and completion criteria

Use focused Node tests, then run
`node --experimental-default-type=module --test tests/*.mjs`.

Cover valid staged responses and assembled definitions, renamed/custom IDs, different
NPC progression policies, overlapping collection targets, field types/ranges, duplicate identifiers, corrupted
JSON, truncated responses, unsupported formulas, repair failure, cancellation, late
responses, naming collisions, and import/export round trips. Verify that generation,
preview, editing, and cancellation do not write live settings, cards, metadata, or items.
Also cover ambiguous manifest references, deterministic ID allocation, unplanned or
missing objects, attempts to change frozen IDs, writes outside a section, dependency
ordering, section retry preserving accepted work, complete draft validation after edits,
request/count limits, aggregate usage, and cancellation during any stage or repair.
Assert that old-run responses cannot populate a replacement run and that assembly
needs no model request. Verify schema-constrained and ordinary JSON response paths.

Run the existing read-only Firefox smoke checks and add unsaved fixtures for the new
dialog, keyboard access, narrow layouts, validation errors, and draft isolation. Mock
request responses for automated UI checks; do not call models or save test Systems.
Include stage progress, partial failure, retry, and disabled save for incomplete work.

Before claiming local-model reliability, separately evaluate representative simple
and moderately complex premises on the actual local model, quantization, and server.
Record first-pass section validity, repairs, final semantic validity, design coherence,
total tokens, and elapsed time. Treat a one-shot comparison as an evaluation baseline,
not an additional production mode. Live model evaluations are separate from automated
tests and require an explicitly chosen connection; do not call models during UI smoke
checks or silently fall back to a cloud provider.

A complete demonstration starts with a premise such as a monster-catching expedition,
generates a bounded draft with player and NPC templates, several small stat gains,
and a correctly targeted reward schedule, edits a rule, and saves a separate System.
The existing adventure stays intact. After deliberate activation in a new adventure,
the generated rules drive normal XP rollover and reviewable rewards through the same
runtime as a manually authored System.

## Schema simplification candidates found during implementation

These are follow-up candidates, not new export formats or data migrations introduced
by the generator. Generation prompts omit obsolete aliases and let canonical defaults
supply presentation details where possible.

| Candidate | Evidence and possible simplification |
| --- | --- |
| NPC `persistence` versus `updatePolicy` | Both describe whether a value travels between adventures. Runtime uses Turn/Advancement. Keep one policy and derive any boundary projection rather than exposing both choices to models. |
| `guidance` versus `hint` | Canonical definitions use guidance; flat Builder/reader data use hint. Collections previously lost their guidance during projection. The generator draft context translates explicitly, and collection import projection now supplies hint. Move consumers to guidance to remove this translation. |
| Top-level `progression.npc` | Actor progression resolves from NPC templates. The generator leaves this historical global block disabled. A future canonical schema can remove the redundant block. |
| `advanceOnLevel` versus progression `statIds` | The former supplies a default selection when IDs are absent; explicit progression configurations already identify candidates. Generation uses the explicit configuration and does not ask for the old flag. |
| HUD `playerStatIds` versus stat `isPrimary` | The floating HUD consumes isPrimary while exports contain both representations. The generator translates selected IDs to player flags; draft capture translates flags back. Use one authoritative selection. |
| HUD `npcStatIds` and `worldStatIds` | They are preserved and validated in definitions, but the floating HUD currently renders only player meters. They should either gain a concrete display consumer or be removed from a future schema. |
| Collection field `id`, `name`, and `label` | IDs and names are both storage/reference keys in different paths; labels are display text. Reward schedules use IDs while holdings use names. Consolidating storage on IDs would reduce rename logic and prompt surface. |
| Stat growth amounts | Runtime chooses one stat and an amount from 1 through 5 for One stat, or independent amounts from 0 through 3 for each selected stat for All selected stats. The generation contract selects candidates only; it contains no fixed increments. |
| Numeric pool defaults encoded as strings | `6/10` is compact but requires repeated parsing and mixes a resource value with its capacity. Explicit numeric starting value/capacity would be clearer if the runtime and editor are changed together. |
| Profile `memory` policy and dedicated memories | Both can express remembered information. Clarify whether memory policy is needed for custom manually edited prose when structured character memories already exist. |

The existing normalized definition remains the shared editor/runtime/export contract.
Do not remove these fields independently in the generator; simplify the canonical
contract and its consumers together in a separate change.
