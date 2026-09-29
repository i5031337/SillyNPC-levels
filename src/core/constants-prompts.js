import { paletteIndexFor } from './hash.js';
export const SPEAKER_PALETTE = Object.freeze([
    '#c0736a', '#5e93c4', '#7fa05a', '#b58a4a', '#9a6fb0',
    '#4fa3a0', '#c4707f', '#8a8fbf', '#a8894f', '#6b9f7c',
    '#b3766d', '#5f86a8', '#9d7bb5', '#a2a05c', '#6f97b8',
]);

/**
 * What the reader is told before it is shown the state and the message.
 *
 * It lives here rather than beside the code that sends it because the settings repair
 * seeds the editable copy from it, and settings.js must not import the extractor.
 */
// Kept for the settings migration: only an untouched copy of this prompt is replaced.
export const PREVIOUS_SYSTEM_PROMPT = [
    'You maintain the state of a roleplaying session.',
    'Given the CURRENT STATE (JSON) and the LATEST MESSAGE, calculate the updated state.',
    'Output ONLY raw JSON. Do not include markdown formatting, code fences (```), explanations, or notes.',
    '',
    '### JSON SCHEMA',
    'Build the reply on these three top-level keys:',
    '{',
    '  "global": {},',
    '  "player": {},',
    '  "characters": []',
    '}',
    'Never use a character name as a top-level key. Characters belong strictly inside the "characters" array.',
    'Add a top-level key only where the request below asks for one - "why", "threads", "closed" and "strangers" are asked for there. Invent no others.',
    '',
    '### PRESENCE & DIFF RULES',
    '1. Keep the output minimal: Include ONLY stats or collections that CHANGED. Omit everything else.',
    '2. Character Presence: ALWAYS include the complete "characters" array listing everyone physically present in the scene after this message, even if none of their stats changed. Drop anyone who left; add anyone who arrived.',
    '3. Collections:',
    '   - Report changes ONLY using "add" and/or "remove". Never restate existing entries.',
    '   - Omitting a collection means nothing changed (the normal case).',
    '   - Use "remove" ONLY when explicitly used up, destroyed, dropped, sold, or stolen. Not being mentioned is NOT a reason to remove. If unsure, leave it out.',
    '',
    '### VALUE & TEXT RULES',
    '- Report values AFTER the events of the message.',
    '- Exact Naming: Use exact stat names from current state. Never invent names; never append _current or _max.',
    '- Pools and scores: a value shown as "current/maximum" in CURRENT STATE keeps that form (e.g., "77/80"). A value shown as a plain number stays a plain number, even when it has a range. Never add "/maximum" to it.',
    '- Replacement: A text value REPLACES the old one; it is never appended to or annotated. Write what is true right now.',
    '- Do not invent events: If the text does not state a change, leave it out.',
    '',
    '### STANDING',
    '- Where a character has a stat for how they regard the player, or the world has one',
    "  for the player's public standing, keep it current.",
    '- RAISE THEM ONLY when {{user}} helps someone, wins publicly, keeps a promise, is generous, or is simply good company.',
    '- LOWER THEM ONLY when {{user}} does something that would actually damage a real friendship, do evil deeds publicly.',
    '',
    '### CONDITION DECAY',
    '- "Condition" describes RIGHT NOW, not history. It must return to a calm baseline as soon as the immediate cause has passed.',
    '- If a character was frightened, hurt or angry in an EARLIER scene but the current message shows them acting normally, set their Condition back to a calm baseline.',
    '- Physical injury is the exception: it persists until treated or rested.',
    '- Emotional states do not persist across scenes.',
    '- Never leave a character in a negative Condition by default. Returning to a calm baseline needs a reason, like any other change: time has passed, the scene has moved on, or the character is plainly behaving normally.',
    '',
    '### TIMING & ACTION COSTS',
    '- A cost announced earlier is paid ONLY when the ACTION RESOLVES (eg.: the roll outcome is described, character get hurt, etc.), even if the latest message does not restate the number.',
    '- Do NOT apply an announced cost if the message is a roll request.',
    '',
    '### OPEN THREADS',
    '- Drop a thread as soon as it is resolved, defused, or made irrelevant by a scene change.',
    '- NEVER keep more than one, time-limited thread at once. Two contradictory countdowns is a bug — keep the most recent and delete the rest.',
    '- A thread must be something a character SAID or PROMISED. Never record an inferred obligation, a prediction, or a required action. Never phrase a thread as something the {{user}} "must" do.',
    '- Threads may be: a plan to meet up, a favor owed to {{user}}, an invitation, a threat, a vilian plan, etc. Record those with equal priority.',
].join('\n');

// Shipped before numeric deltas; existing untouched settings may hold this version.
export const RECENT_SYSTEM_PROMPT = [
    'Read the latest message of a roleplaying session and report what it changes.',
    'Use earlier messages only to interpret the latest one; their effects are already in CURRENT STATE.',
    'Return only raw JSON with "global", "player", and "characters". Add other top-level keys only when the request asks for them.',
    '"global" and "player" contain changed values only. "characters" lists everyone present after the latest message, even when their values did not change.',
    'Use exact configured names. Omit unchanged values and collections. An omitted value means unchanged, never deleted.',
    'For collections, use "add" for acquisitions, "remove" for losses, and "update" for changes to something already held. Do not list everything held.',
    'Keep the form of a stat: a pool such as "8/10" stays a pool, and a plain number stays a plain number.',
    'Report values after the event. Do not invent changes. An announced cost is paid when the action resolves, not when a roll is requested; do not pay it again later.',
    'Raise a relationship or public-standing stat for a concrete helpful or friendly act; lower it for an act that damages that relationship or reputation.',
    'A temporary Condition can return to baseline when the latest message shows recovery or a scene change. Physical injury persists until treated or healed.',
].join('\n');

export const SYSTEM_PROMPT = [
    'Read the latest message of a roleplaying session and report what it changes.',
    'Use earlier messages only to interpret the latest one; their effects are already in CURRENT STATE.',
    'Return raw JSON with "global", "player", and "characters". Add other top-level keys only when requested.',
    '"characters" lists everyone present after the latest message. Omit unchanged stats and collections.',
    'Use exact configured names. Never invent an event or apply a cost already paid.',
    'For an existing numeric reading, report the amount gained or lost in a "deltas" map. Use "globalDeltas" for world stats. Do not calculate the new value.',
    'Use ordinary "stats" values for text, blank numeric stats, or a changed maximum. Never report both forms for one stat.',
    'Collections use "add" for acquisitions, "remove" for losses, and "update" for changes to something already held.',
    'An announced cost is paid when the action resolves, not when a roll is requested.',
    'Raise relationship or public-standing stats for concrete helpful acts; lower them for acts that damage that relationship or reputation.',
    'A temporary Condition can return to baseline after recovery or a scene change. Physical injury persists until treated or healed.',
].join('\n');

/**
 * The palette shade a name lands on.
 *
 * A pure hash of the name, so the same speaker is the same colour in every message, in
 * every chat, forever - and deliberately independent of who else exists. A card picks its
 * colour by starting here and walking to a shade nobody has taken; a speaker with no card
 * cannot do that, because the walk's answer would change the moment an unrelated card was
 * created and their colour would shift under them mid-scene.
 *
 * @param {string} name
 * @returns {string} A hex colour from SPEAKER_PALETTE.
 */
export function paletteColorFor(name) {
    return SPEAKER_PALETTE[paletteIndexFor(name, SPEAKER_PALETTE.length)];
}

/**
 * What the story model is told about laying out dialogue.
 *
 * Everything this extension draws in the chat - avatars, speech blocks, colour - reads a
 * speaker line: a name, in bold, followed by a colon. Nothing asked the model for that
 * shape, so it worked only while the user happened to have a formatting block in their
 * persona. Change persona or preset and the whole presentation stopped, with nothing to
 * say why.
 *
 * It asks for no colour tags on purpose. The extension colours dialogue itself, from each
 * character's own colour, and an inline <font> on the text beats the colour set on the
 * block around it - so a model told to colour would quietly override the setting the user
 * chose.
 */
/**
 * A working set of narrator rules, offered on the first switch-on and by Restore
 * recommended.
 *
 * These are the four that models most reliably break when the same words are written into
 * a character card - which is the whole reason this slot exists. Where a rule sits in the
 * prompt decides whether it survives; a card is read once at the top and then buried under
 * the chat.
 *
 * It starts filled rather than empty. Leaving it blank was the more principled reading -
 * what a narrator should do is not the extension's opinion to have - and it made the first
 * run a blank field beside a sentence telling you to write something, which is not
 * guidance. Clearing the box still means send nothing.
 */
export const NARRATOR_RULES_PROMPT = [
    '### NARRATOR',
    '[Formatting & Meta]',
    '- Narrate in the second person ("You").',
    '- End a turn however the scene wants to end. A hook is optional and should be rare - see the Scene Contract. "What do you do?" with nothing attached is a complete ending.',
    '- Keep Out-Of-Character communication strictly contained within ((double brackets)).',
    '',
    '[Pacing & Narrative Modes]',
    '1. DIALOGUE & SOCIAL MODE:',
    '- Let conversations unfold natural.',
    "- LIVING WORLD: the town exists when nobody is looking. This means schedules, weather, gossip and other people's ordinary days - not that something must happen every reply.",
    '  A still, quiet scene is correct and requires no ambient event',
    '2. ACTION & HAZARD MODE:',
    '- Concise, punchy paragraphs (1-4 paragraphs).',
    '- Respect roll outcomes.',
    '3. TRAVEL & TRANSITION MODE:',
    '- Summarize uneventful transitions or routine time-skips in 1-2 atmospheric paragraphs, placing {{user}} directly at the new scene.',
    '',
    '[MANDATORY ROLL GATE - DO NOT RESOLVE ACTIONS EARLY]',
    'Whenever {{user}} declares an attack, spell, dodge, or risky action:',
    '1. Immediately FREEZE the narrative at the exact moment of the attempt.',
    '2. State the required Attribute/Skill Check + any modifier, target DC, and any cost.',
    "3. HARD STOP: Strictly forbidden from narrating success, failure, or damage in this turn. Stop and wait for {{user}}'s roll result.",
].join('\n');

export const DIALOGUE_FORMAT_PROMPT = [
    '### DIALOGUE FORMAT',
    '- Spoken Dialogue: Start a new paragraph for each speaker using:',
    '  **Character Name**: "Dialogue goes here."',
    '- Actions & Expressions: Describe physical actions, body language, and environmental details in separate paragraphs using *italics*.',
    "- Never mix two characters' dialogue or actions in the same paragraph.",
].join('\n');

/**
 * What a character *is*, as named fields rather than a paragraph.
 *
 * The NPC lore fields have named lines in the entry and a card mirror for tracker and
 * portrait consumers. Named fields can be laid out and corrected individually.
 *
 * Four, and fixed. Everything else a character might have - their job, their ties, their
 * rank, what they are hiding - varies by system and belongs in System Builder where you
 * can name it yourself. Age, looks, temperament and how somebody talks are true of a
 * character in every system there is, which is the whole test for being on this list.
 *
 * THE RULE THAT MAKES THEM WORTH HAVING: the per-message reader never writes one. It is
 * asked about stats, which change, and these do not - a value re-proposed every turn is
 * the drift that made attributes wander in the first place. They are written by hand, or
 * once by Fill into a field that is still empty.
 *
 * `hint` is what Fill tells the model to write, so the prompt is generated from this list
 * rather than spelled out a second time somewhere it can fall out of step.
 */
/* Moved here from defaultSettings, where being a default meant normalizeSettings cloned
 * it into every settings.json and then never updated it - so a stored copy went stale the
 * day the built-in improved, and a key that looks editable but is not invited exactly that
 * misreading. It is a constant: recommendedImagePrompt reads it directly so a Restore
 * button hands back the suggestion rather than the text somebody was trying to replace.
 * The editable template is imgGenPrompt, which is a different key. */
/** Portrait prompt sent to SillyTavern Image Generation. */
export const IMAGE_PROMPT = 'masterpiece, best quality, highly detailed, portrait of {{name}}, ' +
    '{{lore}}, {{items}}, solo, upper body, looking at viewer, ' +
    'detailed face, cinematic lighting, sharp focus, {{context}}';
