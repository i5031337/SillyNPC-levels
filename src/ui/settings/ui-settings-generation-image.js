import { buildSettingSelect } from '../shared/ui-shared.js';
import { PORTRAIT_SHAPES } from '../../core/constants.js';
import { buildBackendDestinationNote } from './ui-settings-generation-helpers.js';
import { renderImageStorageSettings } from './ui-settings-generation-storage.js';

export function renderImageGenerationSettings(view, rerender) {
    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.style.marginTop = '20px';
    title.textContent = 'Image Generation';
    view.append(title, buildBackendDestinationNote());

    view.append(buildSettingSelect({
        key: 'portraitShape', label: 'Portrait Shape',
        options: Object.entries(PORTRAIT_SHAPES).map(([value, shape]) => ({ value, label: shape.label })),
        help: "Sends dimensions to SillyTavern's Image Generation extension. Choose its own resolution to leave the host setting in charge.",
        onChange: rerender,
    }));
    view.append(buildSettingSelect({ key: 'imgGenContextMessages', advanced: true, label: 'Image Context Length',
        options: [{ value: 0, label: 'Lore Only' }, { value: 5, label: '5' }, { value: 10, label: '10' }, { value: 20, label: '20' }] }));
    const storage = document.createElement('details');
    storage.className = 'sillynpc-customize';
    const summary = document.createElement('summary');
    summary.textContent = 'Portrait storage and cleanup';
    storage.append(summary);
    renderImageStorageSettings(storage);
    view.append(storage);
}
