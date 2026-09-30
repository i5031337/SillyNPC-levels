import { placeWritingPrompt } from './prompt-slot.js';
import { getSettings } from '../core/settings.js';
import { debugLog, NARRATOR_RULES_PROMPT } from '../core/constants.js';

export const NARRATOR_RULES_KEY = 'sillynpc-narrator-rules';

export function narratorRulesText() { return NARRATOR_RULES_PROMPT; }

export function applyNarratorRulesPrompt() {
    const settings = getSettings();
    const text = narratorRulesText();
    const off = !settings.enabled || !settings.narratorRulesEnabled;

    const inList = settings.narratorRulesInPromptList === true;
    const depth = Number(settings.narratorRulesDepth ?? 0);

    placeWritingPrompt(NARRATOR_RULES_KEY, off ? '' : text,
        { inList, depth, name: 'SillyNPC - Narrator Rules' });

    if (off || !text) return;
    debugLog(inList
        ? 'Narrator rules handed to SillyTavern\'s prompt list'
        : `Narrator rules sent at depth ${depth}`);
}
