import { buildSettingSelect, buildSettingTextArea, buildSettingToggle } from '../shared/ui-shared.js';
import { PORTRAIT_SHAPES } from '../../core/constants.js';
import { buildBackendDestinationNote } from './ui-settings-generation-helpers.js';
import { renderImageStorageSettings } from './ui-settings-generation-storage.js';

export function renderImageGenerationSettings(view, rerender) {
    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.style.marginTop = '20px';
    title.textContent = 'Image Generation';
    view.append(title, buildBackendDestinationNote());

    view.append(buildSettingToggle({
        key: 'autoPortraitOnFill', label: 'Draw Portrait Automatically',
        help: 'Draw and assign a missing portrait after empty-card Fill or Generate Profiles For New NPCs. '
            + 'Uses profile fields selected for image prompts with SillyTavern Image Generation, which may be billed separately.',
    }));
    view.append(buildSettingTextArea({
        key: 'imgGenPromptPrefix', label: 'Image Prompt Prefix', rows: 2,
        help: 'Placed before the selected profile fields and carried items for every portrait. '
            + 'Use composition instructions such as Solo, profile picture to discourage duplicate characters or moodboards. '
            + 'Clear it to omit the prefix. Manual generation includes it in the editable prompt; '
            + 'SillyTavern Image Generation may also add its own prefix.',
    }));
    view.append(buildSettingSelect({
        key: 'portraitShape', label: 'Portrait Shape',
        options: Object.entries(PORTRAIT_SHAPES).map(([value, shape]) => ({ value, label: shape.label })),
        help: "Sends dimensions to SillyTavern's Image Generation extension. Choose its own resolution to leave the host setting in charge.",
        onChange: rerender,
    }));
    const storage = document.createElement('details');
    storage.className = 'sillynpc-customize';
    const summary = document.createElement('summary');
    summary.textContent = 'Portrait storage and cleanup';
    storage.append(summary);
    renderImageStorageSettings(storage);
    view.append(storage);
}
