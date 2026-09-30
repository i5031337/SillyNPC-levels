import { placeWritingPrompt } from './prompt-slot.js';
import { getSettings } from '../core/settings.js';
import { DIALOGUE_FORMAT_PROMPT, debugLog } from '../core/constants.js';

export const DIALOGUE_FORMAT_KEY = 'sillynpc-dialogue-format';

export function dialogueFormatText() {
    return DIALOGUE_FORMAT_PROMPT;
}

export function applyDialogueFormatPrompt() {
    const settings = getSettings();
    const off = !settings.enabled || !settings.dialogueFormatEnabled;

    placeWritingPrompt(DIALOGUE_FORMAT_KEY, off ? '' : dialogueFormatText(), {
        inList: settings.dialogueFormatInPromptList === true,
        depth: Number(settings.dialogueFormatDepth ?? 0),
        name: 'SillyNPC - Dialogue Format',
    });

    if (off) return;
    debugLog(settings.dialogueFormatInPromptList === true
        ? "Dialogue format handed to SillyTavern's prompt list"
        : `Dialogue format sent at depth ${Number(settings.dialogueFormatDepth ?? 0)}`);
}
