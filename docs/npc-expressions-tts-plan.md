# NPC Expressions and TTS integration plan

Status: Stages 1, 2, and 4 implemented; Stage 3 host adapter superseded. Updated 2026-10-09.

Add mood sprites and individual voices to SillyNPC NPCs using the dialogue lines
SillyNPC already recognizes and highlights. Expressions can reuse SillyTavern's
classifier and sprite storage with a SillyNPC display. Stage 4 gives SillyNPC an
independent speech connection and one ordered queue for narration and dialogue.

## Agreed scope

- Each speaker has their own dialogue line, as required by the existing narrator
  instructions. Use the same recognition and identity resolution as highlighting.
- Classify only the recognized dialogue text. Do not assign surrounding prose,
  actions, or scene context to NPCs.
- Read narration and recognized dialogue in message order. NPC voices read only
  their quoted speech; prose and actions use the narrator voice. Omit speaker labels.
- For a completed reply, each NPC's last dialogue line determines their current
  sprite. Dialogue portraits can retain the expression for their individual line.
- Initially operate on completed replies. Automatic streaming narration and
  expressions synchronized to speech are later stages.
- Stage 4 starts with a separately configured local OpenAI-compatible speech
  endpoint, model, narrator voice, and NPC voices. Broad support for every built-in
  TTS provider, pitch, rate, and emotional delivery remains outside the MVP.

Multiple speakers in one highlighted block are not an expected workflow. Do not
build a new attribution engine to support it. If malformed input cannot be resolved
by the existing highlighting rules, leave it outside NPC presentation.

## Existing interfaces and limitations

The host baseline is SillyTavern 1.19.0, commit `06bde939f`. Recheck relevant host
interfaces before implementing each adapter; exported functions are not necessarily
a stable external integration contract.

| Component | Reuse | Limitation |
| --- | --- | --- |
| SillyNPC dialogue | `dialogueLabels`, resolved avatar identity, `messageBeats`, and `sillynpc-message-rendered` | Beats describe rendered paragraphs and can contain more text than just the quoted dialogue |
| Expressions classification | Exported `getExpressionLabel` and `getExpressionsList` | Some settings derive context and sprite labels from the native character |
| Expressions assets | Sprite GET, upload, ZIP upload, and delete endpoints | Files live in host user storage separately from NPC metadata |
| Expressions display | Existing labels and sprite-pack conventions | Native holders and Visual Novel layers assume actual host characters/group members |
| TTS | Providers, voice lists, filters, synthesis and playback queues, controls | Active provider, voice map, enqueue and reset functions are private |

SillyNPC references:

- [Dialogue label recognition](../src/chat/dialogue-line.js)
- [Portrait and speaker identity resolution](../src/chat/chat-portraits.js)
- [Message beats and decoration event](../src/story/beats.js)
- [Character ownership](../src/characters/character-repository.js)
- [Character transfer](../src/characters/character-transfer.js)
- [Existing image tags](../src/characters/image-tags.js)

Host references at the inspected baseline:

- `public/scripts/extensions/expressions/index.js`: `getExpressionLabel` at
  line 1091, `getExpressionsList` at 1456, `sendExpressionCall` at 667.
- `src/endpoints/sprites.js`: sprite listing at line 118 and folder handling at 18.
- `public/scripts/extensions/tts/index.js`: message enqueue at line 268,
  segment parsing at 537, synthesis events at 506, voice-map initialization at 1469.
- `public/scripts/extensions/tts/system.js`: direct browser speech at line 271.
- [Official TTS configuration documentation](https://docs.sillytavern.app/extensions/tts/)

## Shared dialogue contract

Introduce a small dialogue presentation module that returns ordered records with
NPC ID, display name, dialogue text, line index, and message revision identity.
The revision identity must distinguish chat, message, swipe, and changed content.
Keep DOM elements out of persisted records.

Use the highlighted line as the source of attribution. `messageBeats` can locate
resolved speakers, but its general paragraph text must not automatically become
the spoken or classified text. Extract the dialogue content using the same quote
and line conventions that highlighting accepts. Preserve quote structure until
the applicable TTS filters run.

Resolve aliases to card IDs. A player/persona line remains distinguishable and does
not inherit an NPC voice. For an unknown speaker without a card, retain the existing
portrait fallback and omit NPC-specific presentation until a card exists.

The module must work when optional color or portrait display settings are off.
If resolution currently depends on visible decoration, expose the existing
resolution logic for reuse rather than implement a competing name parser.

Rendering or loading historical messages must not automatically trigger speech or
model classification. Only new completed replies initiate automatic work. Manual
replay can use historical lines; cached expressions can render without requests.

### Stage 1 interfaces

`src/chat/dialogue-discovery.js` owns the DOM discovery and card/alias matching
consumed by both highlighting and presentation. It extracts quoted speech on each
recognized line, excluding unquoted prose and action spans between passages.
Complete quotes are required for presentation records; highlighting can still
recognize a line while its reply is streaming. Code, hidden content, tracker panels,
and table widgets are excluded from discovery.

`readDialogueRecords(mesEl)` in `src/chat/dialogue-presentation.js` reads a clone
with visual decorations removed. It returns JSON-compatible records with
`messageId`, `revision`, `lineIndex`, `npcId`, `displayName`, `speakerLabel`,
`isPersona`, `text`, and `quotedText`. `quotedText` retains quotation delimiters for
TTS filters; `text` contains only their contents. Unknown speakers have a null NPC
ID. Persona lines also have a null NPC ID and set `isPersona`.

The revision includes host chat/character/group identity, message index, swipe,
raw source, and translated display text. Reads do not start model or audio work.
Consumers must gate automatic work on extension enablement and new completed
replies; records remain readable when visual options or the master switch are off.
The existing `sillynpc-message-rendered` event remains a decoration notification,
not authorization to classify or play every rendered historical message.

## NPC configuration and persistence

Add optional presentation configuration to NPC records, normalized alongside other
card settings. Proposed contents are expression enablement, sprite-folder binding,
fallback label, and voice selections keyed by provider. The implemented Stage 1
property names are listed below.

Store chat NPC configuration in its existing chat metadata record, and reusable
defaults on the reusable card. Preserve the existing copy-to-chat behavior and
repository write boundaries. Do not write assignments into global name-keyed maps
that merge different NPCs with the same name.

Use stable asset-folder bindings instead of deriving folders from editable NPC
names. Permit binding an existing sprite pack. Host sprite paths support a folder
and one subfolder; avoid deeper nesting. Automatic expression changes must not
overwrite the card's selected base `imageUrl`.

Character exports should carry presentation preferences and provider voice
references, with explicit unresolved bindings on import. Local file paths alone
are not portable sprite assets. Keep asset packaging as a separate feature; do not
embed images or credentials into NPC records. Imported older records gain disabled
or empty presentation defaults and retain their existing behavior.

Existing image tags support stat-derived pictures. Dialogue emotions do not require
a System Mood stat, and the current stat-field registration API should not be
repurposed as an expression-label registry. Prefer host sprite labels for the MVP.
If System definitions or generation rules are changed later, update generation
contracts, requests, validation, and fixtures in the same change.

### Stage 1 configuration

The implemented `card.presentation` shape is:

```json
{
  "expressions": {
    "enabled": false,
    "spriteFolder": "",
    "fallback": "neutral",
    "bindingStatus": "unverified"
  },
  "voices": {
    "Example provider": {
      "mode": "voice",
      "voiceId": "provider-voice-id",
      "voiceName": "Display name",
      "bindingStatus": "unverified"
    }
  }
}
```

The default voice map is empty. Each configured provider accepts `default`,
`voice`, or `disabled` mode. `normalizeNpcPresentation` and
`normalizeCharacterPresentation` in `src/core/npc-presentation.js` repair the
shape and retain only portable preferences. Imported folder/selected-voice
references are marked `unresolved`; ordinary references remain `unverified`
until a runtime adapter checks availability. No stored status claims successful
asset or voice resolution.

Defaults are applied to newly created, loaded, and imported cards. Reusable-card
instances copy preferences independently. Character transfer remains version 2
with an additive `presentation` field; older exports receive disabled expressions
and an empty voice map. Expression editor controls and runtime sprite checks land
in Stage 2; the voice preferences gained an editor in later stages.

## Expressions adapter

Reuse the configured host classifier where it can classify supplied dialogue.
Classify the last recognized line for each NPC once per completed reply. Cache
the result by revision, NPC, dialogue, and relevant classifier configuration.
Show a fallback immediately and discard results belonging to an obsolete revision.

Two host behaviors need explicit handling:

- LLM raw mode uses the supplied text, while full prompt mode uses current
  conversation context through `generateQuietPrompt`. Full mode must not silently
  be treated as dialogue-only classification. Initially support local/raw-text
  classification and show a clear configuration hint for unsupported mode.
- Available-sprite filtering resolves the native character's folder. Disable that
  filtering in the reused helper and map labels against the NPC's own pack. Any
  custom LLM prompt must constrain labels to the intended NPC vocabulary.

Serialize LLM classification jobs, cache completed results, and avoid repeated calls
during DOM reprocessing. Coordinate scheduling with native Expressions and the
background reader so presentation does not flood the main model connection.

Resolve assets through the host sprite backend. Select variants consistently per
line/revision so re-rendering does not randomly change the picture. Fallback order:
matching label, configured fallback sprite, existing NPC portrait.

Render NPC sprites in SillyNPC-owned UI: dialogue portraits first, with an optional
NPC sprite panel for the current reply. Preserve full-body sprite framing in the
panel. Leave native expression holders under the host extension's control; its
worker and group-layer cleanup can overwrite injected NPC content.

## Stage 4: SillyNPC-owned TTS

Stage 4 supersedes the earlier host queue proposal. SillyNPC owns narration and
NPC dialogue playback through one ordered queue. The initial provider is a
separately configured local OpenAI-compatible `/v1/audio/speech` endpoint, with
its own model, voice list, narrator voice, and per-NPC voice bindings. The user
may copy the current built-in OpenAI Compatible connection as a starting point;
subsequent changes are independent. The existing SillyTavern server proxy can
carry requests to a local server without a browser CORS dependency. Its API key
is the host's existing OpenAI-compatible TTS secret, so separate credentials
require a later server-side adapter.

Build ordered speech units from rendered story content and shared dialogue
discovery. Narration paragraphs use the narrator voice. A recognized speaker
paragraph is split around its accepted quote spans: quoted passages use that
NPC's voice; surrounding prose and actions use narration. Exclude speaker labels,
code, hidden text, tracker panels, and widgets. Unknown speakers and persona
lines use the narrator voice until explicitly configured. Preserve chat, swipe,
edit, and displayed-text revision identity for every unit.

Offer SillyNPC Play and Stop controls for historical messages and an opt-in
automatic mode for new completed replies. History rendering and decoration
refreshes never start audio. One controller owns synthesis, audio playback,
queue order, cancellation, and errors. Stop, a new play request, a new generation,
edit, swipe, deletion, chat switch, provider setting change, or disabling the
extension invalidates in-flight work and stops current audio. Recheck revision
before and after each synthesis and before audio starts. Keep controls responsive
while a request is pending.

The built-in TTS extension must not automatically narrate the same replies while
SillyNPC automatic speech is enabled. The UI should show a direct warning when
both automatic modes are on, without silently changing the user's built-in TTS
settings. Its megaphone remains a separate control; SillyNPC Play always uses the
SillyNPC queue. No host TTS extension patch is needed for Stage 4 playback.

Stage 3 briefly used experimental host voice hooks. Stage 4 replaced that editor
with SillyNPC's own connection and removed the host patch and adapter. Saved
Stage 3 voice bindings remain readable as a fallback for the OpenAI-compatible
provider; changing a voice writes the new SillyNPC binding.

## Playback synchronization

The SillyNPC queue knows when its own HTML audio starts and ends. Stage 5 can
emit playback start/end/cancel with NPC and line identity before connecting
sprite changes to speech. Future direct-playback providers need their own
start/end callbacks.

Synchronization can classify each line ahead of playback, update the active speaker
sprite when that line starts, and retain the last expression after playback ends.
Mood selection still uses dialogue only. Do not delay the first TTS milestone on
animation, lip sync, or emotional voice delivery.

## Implementation stages

| Stage | Deliverable | Completion criteria |
| --- | --- | --- |
| 1 complete | Shared dialogue records and NPC configuration | Highlighted lines resolve to the same NPC IDs and order; labels/prose are excluded; ownership, rename, defaults, and transfer behavior are verified |
| 2 complete | Sprite binding, preview, and automatic expressions | Last line selects each NPC's current sprite; missing assets fall back; stale results cannot update a different chat or swipe; native Expressions coexist |
| 3 superseded | Host TTS voice prototype | The experimental host hooks were removed when Stage 4 adopted its own provider configuration |
| 4 complete | Independent narration and NPC playback | Narration and quoted dialogue play in order with separate voices; SillyNPC Play, Stop, opt-in automatic mode, stale cancellation, and duplicate-narration warning work |
| 5 | Optional playback synchronization | Sprite changes follow audible SillyNPC lines; synthesis completion cannot advance the displayed speaker |
| 6 | Optional streaming and provider styling | Streaming emits each completed dialogue unit once, cancels stale work, and preserves ordering; style controls appear only for supported providers |

Complete and verify each stage before widening scope. Update this plan's status and
record actual interfaces as stages land. Keep new source modules below 20 kB and
separate dialogue, expression, voice, and playback responsibilities.

## Verification

Use focused Node tests for dialogue extraction, alias resolution, ordering,
ownership, settings normalization, transfer, caching, stale-result rejection,
voice fallback, and speech queue routing. Mock classification and synthesis
when checking routing; model quality requires deliberate manual samples.

Verify UI and event behavior in running SillyTavern with the Windows Edge check
or the older Firefox WebDriver workflow. Cover:

- Two NPCs alternating dialogue, with one speaking again at the end.
- Unicode names and quote styles accepted by current highlighting; aliases and
  unknown speakers; player dialogue distinguished from NPCs.
- Prose between dialogue lines, tracker blocks, and widgets excluded from output.
- Highlighting display options disabled without losing identity resolution.
- Same-name NPCs in different chats, rename, reusable-card instantiation, and import.
- Missing sprite files, sparse packs, unavailable classifiers, and missing voices.
- Manual historical playback, automatic new-reply playback, and no automatic work
  from history loading or decoration refresh.
- Provider change, Stop, edit, swipe, regeneration, deletion, and chat switch while
  classification or synthesis is pending.
- Native Expressions enabled alongside NPC sprites; native TTS controls without
  duplicate playback; HTTP audio and System speech synchronization when Stage 5 lands.

Temporary host fixtures must restore chat and metadata, avoid saving fixtures, and
clean up injected scripts. Do not make real model or paid TTS requests solely to
verify rendering. Record any remaining manual provider checks with each stage.

### Stage 1 verification results

On 2026-10-08, all 68 Node test files passed. New focused coverage is in
`tests/dialogue-presentation.mjs` and `tests/npc-presentation.mjs`.
`python3 tests/ui-dialogue-presentation.py` passed in the running host, including
fragmented quotes, actions rendered as emphasis, speech wrappers, hidden names,
removed portraits, player identity, aliases, ordering, and revision isolation.
`python3 tests/ui-smoke.py` also passed. The fixtures made no model/audio requests
or settings/chat saves. Sprite selection and expression editor controls landed in
Stage 2. Voice provider integration followed in later stages.


### Stage 2 interfaces and verification results

Implemented on 2026-10-08:

- NPC Edit has a Dialogue expressions section with opt-in automatic expressions,
  an existing sprite-folder binding, fallback label, pack availability check,
  label selector, and full-image preview. Folder depth uses the Stage 1 validator.
  Preferences save to the owning chat metadata or reusable settings record;
  previews do not classify, generate assets, or save availability claims.
- `src/expressions/host-expressions.js` uses `/api/sprites/get?name=...` and the
  host's exported `getExpressionLabel`. Local (0), Extras (1), and WebLLM (3)
  classify supplied dialogue text. Native available-sprite filtering is disabled.
  WebLLM receives a prompt constrained to labels in the NPC's own pack; the host
  still parses its response using its registered labels. Custom pack labels for
  WebLLM therefore also need registration in native Expressions.
- Main-LLM classification (2) is deliberately unavailable in this adapter. Full
  mode reads conversation context; raw mode has no public shared request lock
  with native Expressions and the background reader. The editor explains both
  limitations and suggests supported modes. Main-LLM support needs an explicit
  host coordination interface; this stage makes no changes to host source files.
  Local/Extras classification does not use the main model connection. NPC WebLLM
  jobs run serially, but there is no shared lock with other WebLLM consumers.
- `expression-events.js` authorizes work only after a changed, completed normal,
  swipe-generation, regeneration, or continuation reply. Dry runs, quiet requests,
  history loads, decoration refreshes, and unchanged/failed generations do not
  authorize work. Stop and source/chat changes invalidate pending work. Selecting
  a historical swipe only restores cached pictures; it does not classify again.
- `completeNpcExpressions` selects each NPC's last recognized dialogue line.
  `expression-engine.js` serializes jobs and deduplicates pending/completed
  classification by revision, NPC, dialogue, classifier settings, NPC preferences,
  and pack vocabulary. The session
  cache and rendered results are bounded to 128 entries. Runtime guards also check
  NPC preferences and current card ownership. Cached pictures survive subsequent
  replies in the same chat; chat changes clear the cache. Results are not persisted.
- SillyNPC dialogue portraits render the resulting current expression for that
  NPC in that reply. Variant selection is deterministic per revision and NPC.
  Missing labels use the configured fallback; empty/missing packs use the original
  portrait. A failed matching image tries the fallback sprite, then the original
  portrait. Automatic changes never write `imageUrl`. Native expression holders
  and Visual Novel layers remain under host control. Per-line emotions and an
  optional full-body current-reply panel are not part of this implementation.

All 69 Node test files passed. `tests/npc-expressions.mjs` covers last-line
selection, stable variants, sparse packs, serialized/deduplicated requests,
classifier failure recovery, stale-result rejection, completion-event gating, and
tracker status-block cleanup before deferred classification.
`python3 tests/ui-npc-expressions.py` passed in running SillyTavern with mocked
classification and sprite listings, checking two alternating NPCs, last-line
selection, caching, swipe/edit isolation, unchanged base portraits, previews,
invalid folders, controls, missing-image fallback, unsupported-mode hints, and
native holder isolation.
`python3 tests/ui-smoke.py` passed. These fixtures made no model requests or saves.

Remaining deliberate manual checks: real Local/Extras model availability, real
WebLLM classification quality and contention with native WebLLM consumers, real
sprite packs including deleted image files, and native Expressions enabled in
Visual Novel/group mode alongside the NPC portraits.

### Stage 4 interfaces and verification results

Implemented on 2026-10-09:

- `src/tts/tts-settings.js` normalizes separate endpoint, model, voice list,
  narrator voice, speed, enablement, and opt-in automatic playback settings.
  Extension settings offer a one-time copy of the built-in OpenAI Compatible
  connection. The NPC editor stores per-card choices under
  `presentation.voices['SillyNPC OpenAI Compatible']`, with default narrator,
  explicit silence, and missing-voice status. The previous `OpenAI Compatible`
  binding is read only when no SillyNPC binding exists.
- `speech-units.js` reads rendered story paragraphs and shared dialogue matches.
  It separates accepted quoted passages from surrounding narration and actions,
  excluding labels, code, widgets, hidden content, and tracker UI. Units carry
  exact chat/message/swipe/content revision identity.
- `speech-queue.js`, `openai-speech.js`, and `npc-tts.js` own sequential synthesis
  and audible playback. The queue starts synthesizing the next unit as soon as
  the previous synthesis returns, while playing units in order and buffering at
  most three units. Each assistant message has a SillyNPC Play/Stop button.
  Automatic playback is off by default and is authorized only after a changed
  completed foreground reply. Built-in automatic TTS blocks SillyNPC automatic
  playback and is flagged in settings; manual SillyNPC Play remains available.
  Stop, new play, generation, edit, swipe, deletion, chat switch, and setting
  changes cancel work. The built-in TTS source patch was reversed.

The Node suite passed 425 tests. `node tests/ui-npc-voices.cjs` passed in the
running Windows host with unsaved fixtures: narration/dialogue/action ordering,
an NPC voice distinct from narration, the manual button, sequential mocked
audio responses for manual and opt-in automatic playback, and the built-in TTS
duplicate guard. `--preview` synthesized and played one short sample through
the configured local Kokoro server. `--real-playback` exercised the actual
three-unit message playback through that server. The browser recorded the
requests in order: narrator `alloy` for "The hall went quiet.", NPC `nova` for
"Wait.", and narrator `alloy` for "She lowers her sword." Each returned HTTP
200 `audio/mpeg` and decoded to a non-silent waveform: 24,237 bytes / 1.51 s,
16,557 bytes / 1.03 s, and 25,389 bytes / 1.58 s, respectively. This verifies
generation and routing without judging pronunciation by ear. The fixtures
restored in-memory settings and chat and made no chat or metadata saves.
Broader provider support, streaming, and sprite synchronization remain later
work.

On 2026-10-09, a follow-up Windows Edge check found and fixed a pause between
segments: synthesis had waited for the previous segment's playback to finish.
`node tests/ui-npc-voices.cjs` and `--real-playback` now assert that requests
for the second and third units begin before the first unit ends. The real
Kokoro check passed with three decodable, non-silent MP3 responses. Focused
queue tests cover ordered playback, bounded prefetch, and Stop cancellation.
The full Node suite passed 426 tests after this change.
