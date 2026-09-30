import { paletteIndexFor } from './hash.js';
export const SPEAKER_PALETTE = Object.freeze([
    '#c0736a', '#5e93c4', '#7fa05a', '#b58a4a', '#9a6fb0',
    '#4fa3a0', '#c4707f', '#8a8fbf', '#a8894f', '#6b9f7c',
    '#b3766d', '#5f86a8', '#9d7bb5', '#a2a05c', '#6f97b8',
]);

export const SYSTEM_PROMPT = [
    'Read the latest message of a roleplaying session and report what it changes.',
    'Use earlier messages for context; their effects are already in CURRENT STATE.',
    'Use exact configured field names. Report only changes caused by the latest message.',
    'For every new NPC, initialize blank configured stats with plausible individual values, even when the story gives no details.',
    'Do not invent profile details. Report profile changes only when the latest message supports them.',
    'For an existing numeric reading, report the amount gained or lost in a "deltas" map. Use "globalDeltas" for world stats. Do not calculate the new value.',
    'Use ordinary "stats" values for text, blank numeric stats, or a changed maximum. Never report both forms for one stat.',
    'For player XP, award only a positive number in "player.deltas". Never put XP in "player.stats" or report an absolute XP total.',
    'Collections use "add" for acquisitions, "remove" for losses, and "update" for changes to something already held.',
    'An announced cost is paid when the action resolves, not when a roll is requested.',
    'Raise relationship or public-standing stats for concrete helpful acts; lower them for acts that damage that relationship or reputation.',
    'A temporary Condition can return to baseline after recovery or a scene change. Physical injury persists until treated or healed.',
    'Return raw JSON with "global", "player", and "characters". Add other top-level keys only when requested.',
    '"characters" lists everyone present after the latest message. Omit unchanged stats and collections.',
].join('\n');

export function paletteColorFor(name) {
    return SPEAKER_PALETTE[paletteIndexFor(name, SPEAKER_PALETTE.length)];
}

export const DIALOGUE_FORMAT_PROMPT = 'Start each spoken line with the speaker\'s actual name and a colon: Name: "dialogue".';
export const NARRATOR_RULES_PROMPT = DIALOGUE_FORMAT_PROMPT;

export const IMAGE_PROMPT = '{{lore}}\n{{items}}';
