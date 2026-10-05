import { PORTRAIT_SHAPES, DEFAULT_PORTRAIT_SHAPE } from './constants.js';
import { defaultSettings } from './settings-defaults.js';
import { resolveImageFolder } from './utils.js';
import { saveSettings } from './settings.js';

export function normaliseBaseSettings(settings) {
    // The old portrait switch was opt-in. Automatic Fill now draws portraits by default;
    // use a new key so an old, default false does not silently disable the new behavior.
    delete settings.autoFillPortrait;
    // Renames have to run before the defaults loop below. That loop fills in every absent
    // key, so by the time it has finished, portraitShape always exists and there is no way
    // left to tell "the user never set this" from "the user chose the default".
    //
    // The old geminiImageAspectRatio only ever reached the Gemini path, while /sd carried
    // its own hardcoded pixels that disagreed with it; portraitShape governs both. Ratios
    // the old setting allowed but the new table does not list (3:2, 4:3, 16:9) have no /sd
    // pixel equivalent worth inventing, so they fall through to the default.
    if (settings.geminiImageAspectRatio !== undefined) {
        if (settings.portraitShape === undefined
            && Object.hasOwn(PORTRAIT_SHAPES, settings.geminiImageAspectRatio)) {
            settings.portraitShape = settings.geminiImageAspectRatio;
        }
        delete settings.geminiImageAspectRatio;
    }

    for (const [key, value] of Object.entries(defaultSettings)) {
        if (settings[key] === undefined) {
            settings[key] = structuredClone(value);
        }
    }

    for (const key of ['dialogueFormatPrompt', 'narratorRulesPrompt', 'generationPrompt',
        'imgGenPrompt', 'imgGenNegativePrompt', 'imgGenContextMessages', 'promptTexts']) delete settings[key];
    for (const key of ['extractionPrompt', 'systemRules']) delete settings.statusTracker[key];
    // Old exports may contain the removed direct Gemini backend settings.
    for (const key of ['imageBackend', 'geminiImageModel', 'imageProfileId', 'imgGenReferencePreamble']) {
        delete settings[key];
    }

    if (typeof settings.imgGenPromptPrefix !== 'string') {
        settings.imgGenPromptPrefix = defaultSettings.imgGenPromptPrefix;
    }

    if (!Object.hasOwn(PORTRAIT_SHAPES, settings.portraitShape)) {
        settings.portraitShape = DEFAULT_PORTRAIT_SHAPE;
    }

    // The token and character limits are free-entry numbers now, with no slider to keep
    // them sane, so a blank or half-typed field can reach here as '' or NaN. Repair on
    // read rather than blocking entry, so the user can clear the box and retype.
    // A zero-token reply budget or character excerpt cannot produce usable lore.
    for (const key of ['loreCharBudget', 'loreMaxTokens']) {
        const value = Number(settings[key]);
        if (!Number.isFinite(value) || value <= 0) settings[key] = defaultSettings[key];
        else settings[key] = Math.floor(value);
    }
    if (typeof settings.popupWidth !== 'number' || settings.popupWidth < 20) settings.popupWidth = 80;
    if (typeof settings.popupHeight !== 'number' || settings.popupHeight < 20) settings.popupHeight = 80;

    if (settings.keywords) {
        delete settings.keywords;
        saveSettings();
    }
    
    // The save route is a folder name, and only ever was: the upload endpoint reduces it
    // to one segment under user/images/. Storing the raw text meant the value in the file,
    // the value in the box and the value actually used were three different strings for
    // as long as the setting lived - "images/sillynpc" sat there while sillynpc was
    // written. Cleaned once here, so they are one string from then on.
    //
    // No guard for an absent one: resolveImageFolder answers with the default, which is
    // what the defaults loop above would have filled in anyway.
    settings.imageSaveRoute = resolveImageFolder(settings.imageSaveRoute);

}
