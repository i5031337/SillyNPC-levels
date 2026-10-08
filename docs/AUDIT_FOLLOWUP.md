# Audit follow-up: decisions and verification

Follow-up to the October 2026 cleanup audit, source baseline `719f1ec`.

## Decisions

1. Remove clock parsing, elapsed-time anchors, and automatic time-based stat rules.
   Time remains an ordinary tracker field that users can correct manually.
2. Scan collections oldest-first with rolling inventory. Each returned collection
   array replaces that actor's prior array; an omitted actor or collection retains
   its rolling state. Pass the accumulated inventory into the next request. A failed
   or unusable pass stops the scan without publishing partial review proposals.
3. Keep reader/scan fallback to the main API, but show a warning when it happens.
4. Reject a scan before making requests if a selected message exceeds the transcript
   character budget, including its speaker label. Explain the offending message and
   budget. Prompt instructions, schema, and rolling inventory add overhead beyond
   that transcript budget; character counts are not a model context guarantee.
5. Defer changes to profiles and memory. Profile and memory edits remain
   manual; optional initial NPC profile generation is a separate feature.
6. Remove references to the retired story subsystem and its promised archive.
   Remove the dedicated Goals subsystem as well; objectives can use profile fields,
   stats, or collections.

## Checks

Focused regression coverage should verify rolling acquisitions and removals,
consumption, transfers, omitted collections and offstage actors, duplicate names,
failed passes, and standing item decisions. Scans propose changes for review and
never save inventory directly. Preserve NPC template assignments.

Request-routing checks use mocked connections and verify a visible fallback warning,
including unavailable Connection Manager/profile cases. Overflow checks cover labels,
separators, exact budgets, message ordering, and zero requests on rejection.

Run the Node suite and read-only live UI checks:

```bash
node --experimental-default-type=module --test tests/*.mjs
curl --max-time 2 -I http://127.0.0.1:8000/
python3 tests/ui-smoke.py
```

Browser fixtures must restore temporary state, remove injected scripts and result
attributes, and avoid saves or real model requests. Import extension modules through
an injected page-context module rather than WebDriver's direct dynamic import.

## Completed verification

Implemented decisions 1–4 and 6, including removal of the dedicated Goals subsystem.
Decision 5 remains deferred. The final Node suite passed **261 tests**.
The live Firefox UI smoke check and
`tests/ui-audit-followup.py` passed, including editable Time, absence of clock
controls, absence of Goals in the reader schema, exact transcript budgets, and
oversized scan rejection. Routing tests
used mock providers; browser fixtures made no model requests and saved no data.
