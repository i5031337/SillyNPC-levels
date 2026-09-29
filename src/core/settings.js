import { getContext } from '../../../../../st-context.js';
import { saveSettingsDebounced } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';
import { IMAGE_PROMPT } from './constants.js';
import { defaultSettings } from './settings-defaults.js';
import { normalizeSettings } from './settings-migration.js';
import { setProfileSettingsProvider } from './profile-fields.js';
import { setGoalSettingsProvider } from '../tracker/goals.js';
export { defaultSettings, normalizeSettings };
setProfileSettingsProvider(getSettings);
setGoalSettingsProvider(getSettings);
export { normaliseStatDefs } from './settings-migration.js';

export function initSettings() {
    if (!extension_settings.sillynpc) {
        extension_settings.sillynpc = structuredClone(defaultSettings);
    }
    normalizeSettings(extension_settings.sillynpc);
}

/**
 * The portrait template to send.
 *
 * An empty stored template uses the maintained Image Generation prompt.
 * @returns {string}
 */
export function resolveImagePrompt() {
    return recommendedImagePrompt();
}

/**
 * The suggested portrait template, ignoring anything customised.
 *
 * Separate from resolveImagePrompt on purpose: that one answers "what do I send", and
 * a customised template rightly wins there. This answers "what would you suggest", which
 * is what a Restore button needs - asking the other question hands someone back the very
 * text they were trying to replace.
 *
 * @returns {string}
 */
export function recommendedImagePrompt() {
    return IMAGE_PROMPT;
}

export function getSettings() {
    if (!extension_settings.sillynpc) {
        initSettings();
    }
    return extension_settings.sillynpc;
}

export function saveSettings() {
    saveSettingsDebounced();
    // Card editors already save after in-place changes. If this chat owns cards,
    // persist those metadata changes alongside the settings save.
    const context = getContext();
    if (Array.isArray(context?.chatMetadata?.sillynpc_npcs)
        && context.getCurrentChatId?.() !== undefined) {
        context.saveMetadataDebounced?.();
    }
}

/**
 * Returns a JSON string of all settings for export.
 */
export function exportSettingsData() {
    return JSON.stringify(getSettings(), null, 4);
}

/**
 * Imports settings from a JSON string.
 */
export function importSettingsData(jsonText) {
    const data = JSON.parse(jsonText);
    if (!data.characters || !Array.isArray(data.characters)) {
        throw new Error('Invalid export file: missing characters array.');
    }
    
    // Merge, then repair. Imported files can be from any older version, so they
    // must go through the same migration pass as settings loaded at startup.
    Object.assign(getSettings(), data);
    normalizeSettings(getSettings());
    saveSettings();
    return true;
}
