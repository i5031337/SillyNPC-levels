# Player and NPC progression with collection rewards

Progression resolves XP and Level by stable field IDs for the player and independently enabled NPC templates. The reader reports earned XP as a positive delta; extraction converts it to an absolute reading before code stores remainder XP and the new level. New sheets, manual edits, imports, transfers, and template assignments never backfill earned rewards.

## Numeric growth configuration

Each owner selects XP, Level, and eligible numeric stats, then configures:

- `pointsPerLevel`: a nonnegative whole number. Zero disables numeric growth. The budget may exceed the number of selected stats.
- `assignment`: `random` or `manual`.

XP, Level, retired fields, and nonnumeric fields are excluded. Reader locking and NPC carryover are independent of growth eligibility. Older saved configurations retain their candidates and normalize to the new contract; old None configurations use zero points, otherwise selected candidates default to one point and random assignment.

Numeric growth never makes an LLM call. A reading creates one point budget per actor, equal to points per level multiplied by levels gained. Random assigns each point independently with replacement among stats that can accept another whole point. Once a stat reaches its cap, it leaves the available set immediately. Allocations are cached with the reading so missing-reward retries and reloads never reroll them. If every candidate is capped or uninitialized, the unspent budget remains pending.

Manual assignment uses per-stat number inputs and a remaining-points counter in the tracker review. Inputs cannot exceed the budget or the stat's available capacity. Apply selected can spend part of the budget; the rest stays on the originating message for later allocation, including after another level-up. Unselected budgets stay pending. Discard all explicitly rejects the remaining budget.

## Bounds and acceptance

Every point increases a rating by one within its fixed cap. A rating saved as `10/255` still grows its value, not its denominator. Each point increases a pool's current and maximum by one, preserving depletion: `6/10` plus two points becomes `8/12`. Blank pool maxima permit expansion; explicit maximum values limit capacity. Growth does not refill, cleanse, or fully heal pools.

XP and Level form one reviewed transition. Point budgets and collection rewards wait for that transition to be accepted. Rejected XP cannot leave rewards behind. Accepted gains are materialized against live state after ordinary story changes. If caps changed while waiting, only spendable points are consumed and the remainder stays pending.

Budgets preserve immutable actor, persona, template, field, message, swipe, and transition provenance. Only allocations may be edited. Partial spending advances the budget's spent counter and gives applied stat rows distinct IDs. Stale confirmations cannot spend the same version twice. Applied pool rows include both current and maximum, and unspent budgets survive chat serialization. The existing turn baseline and replacement reading handle regeneration and swipes rather than adding a separate global ledger.

## Collection rewards

Collections keep their existing ownership targets and have independent level-up rewards:

- Scheduled rewards propose typed configured entries at every crossed threshold.
- Guided rewards use one batched LLM request to choose suitable typed entries at eligible levels. The model can return `noReward: true` when no suitable new reward exists.

Only guided collection rewards call the model. Requests use short local task keys; persistent identities stay internal. Validate primary identifiers, types, ranges, options, ownership, and duplicates against holdings and story proposals. A failed guided request preserves numeric allocations and scheduled proposals, reports missing rewards, and retries only the missing choices without awarding XP again.

Guided replies request an `entry` object for each task. Flat choices with collection fields directly under the task key are normalized to the same entry contract and validated identically. Explicit wrapped entries take precedence; malformed entries cannot be rescued by unrelated fields outside the wrapper.

## Explicit NPC level-ups

Cast → Card → Edit includes **Trigger Level-up**. This explicit action advances the configured Level once, preserves remainder XP, and prepares the same numeric points and collection rewards as an earned level-up. It works for offstage cards without admitting them to the scene. Progression must be enabled, counters valid, and the next level within its cap.

The level advances immediately; rewards await review below the button. Pending budgets, partial allocations, and guided failures persist in chat metadata by card, System, and persona rather than on a story message. Later manual level-ups do not invalidate these rewards. Discard all rejects rewards without reversing the explicit level advance. Context and counter changes during preparation abort the action; duplicate clicks cannot advance twice.

## Verification

Run `node --experimental-default-type=module --test tests/*.mjs`. Meaningful coverage includes replacement sampling, budgets larger than candidate counts, immediate cap exclusion, all-capped leftovers, multiple levels, locked candidates, pool depletion and capacity, bounded ratings saved with denominators, manual validation and partial spending, serialization, stale confirmations, persona changes, offstage cards, guided retries, and generation schema validation.

Live unsaved fixtures run with `python3 tests/ui-level-rewards.py`, `python3 tests/ui-manual-level-ups.py`, `python3 tests/ui-progression-smoke.py`, and `python3 tests/ui-smoke.py`. Verify player and NPC controls, card button placement, manual budget enforcement, review dependencies, narrow layouts, keyboard access, dry-run purity, and final pool and rating values without saving fixtures or requesting models.
