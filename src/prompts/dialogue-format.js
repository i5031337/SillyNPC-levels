import { placeWritingPrompt } from './prompt-slot.js';
import { getSettings } from '../core/settings.js';
import { DIALOGUE_FORMAT_PROMPT, debugLog } from '../core/constants.js';

/** The key SillyTavern files this injection under. */
export const DIALOGUE_FORMAT_KEY = 'sillynpc-dialogue-format';

/** The dialogue layout understood by the extension's speaker parser. */
export function dialogueFormatText() {
    return DIALOGUE_FORMAT_PROMPT;
}

/**
 * Puts the dialogue format in front of the model, or takes it away.
 *
 * Deliberately not part of the tracker's own generation handler: that one returns early
 * when the tracker is off, and the chat is still decorated then. The formatting the
 * decorator depends on must not be conditional on a feature that has nothing to do with
 * it - which is the whole fault being fixed here, one layer up. It used to depend on the
 * user's persona.
 *
 * Depth 0 puts it after the newest message, the last thing the model reads before
 * answering, because a layout rule is weakest when it is furthest away. Handing the block to
 * SillyTavern's prompt list gives that decision away in exchange for being able to make it
 * anywhere else; see placeWritingPrompt.
 */
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
