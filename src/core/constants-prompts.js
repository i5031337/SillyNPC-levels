import { paletteIndexFor } from './hash.js';
export const SPEAKER_PALETTE = Object.freeze([
    '#c0736a', '#5e93c4', '#7fa05a', '#b58a4a', '#9a6fb0',
    '#4fa3a0', '#c4707f', '#8a8fbf', '#a8894f', '#6b9f7c',
    '#b3766d', '#5f86a8', '#9d7bb5', '#a2a05c', '#6f97b8',
]);

export const SYSTEM_PROMPT = [
    'Read the latest message of a roleplaying session and report what it changes.',
    'Use earlier messages for context; their effects are already in CURRENT STATE.',
    'Use only configured stats and collections, with exact field names. Their meanings, rules, and targets determine which events matter. Report only changes caused by the latest message.',
    'Infer stat effects from resolved actions and their narrated consequences; the narrator need not state field names, numbers, or mechanical changes. Follow configured rules and established effects first. If an effect on a configured field is clear but its amount is unstated, estimate a conservative amount consistent with its current scale and the event. Do not treat missing numbers as no change.',
    'Plans, requests, and unresolved attempts do not establish their intended outcomes. Apply only effects supported by what actually happened; preserve filled locked stats and established pool maxima.',
    'For every new NPC, initialize blank configured stats with plausible individual values, even when the story gives no details.',
    'Do not report profile or memory changes. Lore is handled by manual lore generation.',
    'For an existing numeric reading, report the amount gained or lost in a "deltas" map. Use "globalDeltas" for world stats. Do not calculate the new value.',
    'Use ordinary "stats" values for text, blank numeric stats, or a changed maximum. Never report both forms for one stat.',
    'When progression is enabled for an owner, report earned experience only as a positive delta using that owner\'s configured experience field. Never report its absolute total.',
    'Collections use "add" for acquisitions, "remove" for losses, and "update" for changes to something already held.',
    'Follow each collection\'s configured purpose. For a collection tracking abilities or knowledge, actual use of a named ability establishes that the actor knows it even if its intended outcome fails: add it to the applicable configured collection if missing, without requiring a learning announcement. Mere commands or mentions do not establish knowledge. Never remove a reusable entry merely because it was used; remove entries only when the event establishes their loss.',
    'Apply an announced cost when the action actually incurs it. A plan or request alone does not establish payment.',
    'Use each configured field\'s meaning and rules to determine the direction of change and whether an effect persists. Do not reset values merely because the scene changes.',
    'Return raw JSON with "global", "player", and "characters". Add other top-level keys only when requested.',
    '"characters" lists everyone present after the latest message. Omit unchanged stats and collections.',
].join('\n');

export function paletteColorFor(name) {
    return SPEAKER_PALETTE[paletteIndexFor(name, SPEAKER_PALETTE.length)];
}

export const DIALOGUE_FORMAT_PROMPT = 'Start each spoken line with the speaker\'s actual name and a colon: Name: "dialogue".';

export const IMAGE_PROMPT = '{{lore}}\n{{items}}';
