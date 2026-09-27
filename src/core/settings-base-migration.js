import { GEMINI_IMAGE_MODELS, PORTRAIT_SHAPES, DEFAULT_PORTRAIT_SHAPE, SYSTEM_PROMPT, DIALOGUE_FORMAT_PROMPT } from './constants.js';
import { defaultSettings } from './settings-defaults.js';
import { resolveImageFolder } from './utils.js';
import { saveSettings } from './settings.js';

export function normaliseBaseSettings(settings) {
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

    // The instructions the reader is given are shown in the settings, not hidden behind a
    // button, so seed the box with the built-in text on first run. Empty still means the
    // built-in, which is what someone who clears the box is asking for; this only fills a
    // box that has never been touched.
    //
    // The cost is that a later version improving the built-in will not reach anyone who
    // has been seeded - Restore recommended is how they take the new text.
    // Same reason as the extraction instructions: the box shows what is actually sent
    // rather than sitting blank until someone presses Restore.
    if (!String(settings.dialogueFormatPrompt || '').trim()) {
        settings.dialogueFormatPrompt = DIALOGUE_FORMAT_PROMPT;
    }

    // Shape only. An absent entry means "use the shipped hint", which is the default and
    // needs no seeding - unlike the extraction prompt below, which is copied in once and
    // then belongs to the user forever.
    if (!settings.profileHints || typeof settings.profileHints !== 'object') {
        settings.profileHints = {};
    }
    if (!settings.promptTexts || typeof settings.promptTexts !== 'object' || Array.isArray(settings.promptTexts)) {
        settings.promptTexts = {};
    }

    if (!String(settings.statusTracker.extractionPrompt || '').trim()) {
        settings.statusTracker.extractionPrompt = SYSTEM_PROMPT;
    }
    if (settings.imageBackend !== 'gemini') settings.imageBackend = 'sd';
    if (!GEMINI_IMAGE_MODELS.includes(settings.geminiImageModel)) {
        settings.geminiImageModel = defaultSettings.geminiImageModel;
    }

    if (!Object.hasOwn(PORTRAIT_SHAPES, settings.portraitShape)) {
        settings.portraitShape = DEFAULT_PORTRAIT_SHAPE;
    }

    // The token and character limits are free-entry numbers now, with no slider to keep
    // them sane, so a blank or half-typed field can reach here as '' or NaN. Repair on
    // read rather than blocking entry, so the user can clear the box and retype.
    // Zero means something for one of these and nothing for the others: 0 recent messages
    // is the "Lore Only" image setting, but a 0-token reply budget or a 0-character excerpt
    // is just a broken request. Number('') is 0, so a cleared box lands here too and has to
    // be told apart from a deliberate zero.
    for (const key of ['loreCharBudget', 'loreMaxTokens']) {
        const value = Number(settings[key]);
        if (!Number.isFinite(value) || value <= 0) settings[key] = defaultSettings[key];
        else settings[key] = Math.floor(value);
    }
    {
        const value = Number(settings.imgGenContextMessages);
        if (!Number.isFinite(value) || value < 0 || String(settings.imgGenContextMessages).trim() === '') {
            settings.imgGenContextMessages = defaultSettings.imgGenContextMessages;
        } else {
            settings.imgGenContextMessages = Math.floor(value);
        }
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
