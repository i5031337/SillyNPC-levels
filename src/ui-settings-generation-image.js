import { getSettings } from './settings.js';
import { buildSettingSelect } from './ui-shared.js';
import { buildPromptEditor } from './ui-prompts.js';
import { promptById } from './prompts.js';
import { GEMINI_IMAGE_MODELS, PORTRAIT_SHAPES } from './constants.js';
import { buildConnectionProfilePicker } from './ui-connection-profiles.js';
import { buildBackendDestinationNote } from './ui-settings-generation-helpers.js';
import { renderImageStorageSettings } from './ui-settings-generation-storage.js';

export function renderImageGenerationSettings(view, rerender) {
    const imgTitle = document.createElement('h3');
    imgTitle.className = 'sillynpc-section-title';
    imgTitle.style.marginTop = '20px';
    imgTitle.textContent = 'Image Generation';
    view.append(imgTitle);

    view.append(buildSettingSelect({
        key: 'imageBackend',
        label: 'Portrait Source',
        options: [
            { value: 'sd', label: "SillyTavern's Image Generation (shared)" },
            { value: 'gemini', label: 'Google Gemini image model (set up here)' },
        ],
        help: "SillyTavern's Image Generation draws with whatever that extension is already "
            + 'set to - source, model, sampler, steps - shared with /imagine and everything '
            + 'else in SillyTavern. SillyNPC adds only the prompt and the shape. The Gemini '
            + 'option is configured here instead and is independent of those settings; it '
            + "exists because that extension's Google source lists only imagen-* and veo-*, "
            + 'so the Gemini image models cannot be reached any other way.',
        onChange: rerender,
    }));
    view.append(buildBackendDestinationNote());

    if (getSettings().imageBackend === 'gemini') {
        view.append(buildSettingSelect({
            key: 'geminiImageModel',
            label: 'Gemini Image Model',
            options: GEMINI_IMAGE_MODELS.map(m => ({ value: m, label: m })),
            help: 'Only these models can return an image. Anything else replies with text.',
        }));
        view.append(buildConnectionProfilePicker(rerender, {
            key: 'imageProfileId',
            scope: 'root',
            labelText: 'Image Connection',
            fallbackLabel: 'Whichever Google key is active',
            noteText: 'Whose API key pays for portraits. Only the key and the account are '
                + 'taken from the profile - the model stays the one chosen above, because a '
                + 'connection profile can only name a text model. Left unset, portraits are '
                + 'billed to whichever Google key SillyTavern currently has active, which '
                + 'is the same key your chat is using.',
            unavailableText: 'Connection Manager is not available, so portraits are billed '
                + 'to whichever Google key is active. Enable the Connection Manager '
                + 'extension to choose one.',
        }));
}

view.append(buildSettingSelect({
    key: 'portraitShape',
    label: 'Portrait Shape',
    options: Object.entries(PORTRAIT_SHAPES).map(([value, shape]) => ({ value, label: shape.label })),
    help: 'The shape portraits come back in, for both sources. 3:4 is what the chat '
        + 'avatars and character cards are built around. This used to be fixed at '
        + '512x768 for the Image Generation extension and set separately for Gemini, so '
        + 'whatever Resolution you had chosen in SillyTavern was overridden without '
        + 'saying so - the last option is how you keep it.',
    onChange: rerender,
}));

view.append(buildSettingSelect({ key: 'imgGenContextMessages', advanced: true, label: 'Image Context Length', options: [{value:0,label:'Lore Only'},{value:5,label:'5'},{value:10,label:'10'},{value:20,label:'20'}] }));
view.append(buildPromptEditor(promptById('image')));
// Both of these are backend-specific, and the registry entry knows which - so the
// condition is not written out a second time here.
for (const id of ['imageReference', 'imageNegative']) {
    const entry = promptById(id);
    if (entry.available()) view.append(buildPromptEditor(entry));
}
    renderImageStorageSettings(view);
}
