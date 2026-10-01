import { power_user } from '../../../../../power-user.js';
import { getSettings } from '../core/settings.js';

let restoreUserNameDisplay = false;

/**
 * SillyTavern's cleanUpMessage deletes the entire reply when it begins with
 * "{{user}}:" and allow_name1_display is false. Our writing prompts request
 * "Name: dialogue" lines, including lines spoken by the player, so a valid
 * reply can otherwise disappear before MESSAGE_RECEIVED ever fires.
 */
export function allowStoryPlayerDialogue(type, _options, dryRun) {
    if (dryRun || type === 'quiet' || type === 'impersonate') return;
    const settings = getSettings();
    if (!settings.enabled || (!settings.dialogueFormatEnabled && !settings.narratorRulesEnabled)) return;
    if (power_user.allow_name1_display) return;

    power_user.allow_name1_display = true;
    restoreUserNameDisplay = true;
}

/** Restore the user's SillyTavern setting after its final cleanup pass. */
export function restorePlayerDialogueSetting() {
    if (!restoreUserNameDisplay) return;
    power_user.allow_name1_display = false;
    restoreUserNameDisplay = false;
}
