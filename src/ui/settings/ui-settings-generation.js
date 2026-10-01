import { buildSettingSelect, buildSettingToggle, buildSettingNumber } from '../shared/ui-shared.js';
import { world_names } from '../../../../../../world-info.js';
import { buildConnectionProfilePicker } from './ui-connection-profiles.js';
import { buildLastLoreConnectionNote, updateExcerptReadout, buildWorldInfoScannerSettings } from './ui-settings-generation-helpers.js';
import { renderImageGenerationSettings } from './ui-settings-generation-image.js';

export function renderGenerationSettingsView(view) {
        if (!view) return;
        view.replaceChildren();
        renderLoreSettings(view);
        renderUnknownSpeakerSettings(view);
        renderImageGenerationSettings(view, () => renderGenerationSettingsView(view));
}

function renderLoreSettings(view) {
    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'Lorebook & AI';
    view.appendChild(title);

    view.append(buildWorldInfoScannerSettings());
    view.append(buildSettingSelect({ key: 'defaultLorebook', label: 'Default Target Lorebook', options: [{value:'',label:'-- current --'}, ...(Array.isArray(world_names) ? world_names : []).map(w => ({value:w,label:w}))] }));
    view.append(buildSettingSelect({
        key: 'contextMessages',
        label: 'Chat To Read',
        options: [
            { value: 5, label: 'Last 5 messages' },
            { value: 10, label: 'Last 10 messages' },
            { value: 15, label: 'Last 15 messages' },
            { value: 30, label: 'Last 30 messages' },
            { value: 50, label: 'Last 50 messages' },
            { value: 100, label: 'Last 100 messages' },
            { value: 200, label: 'Last 200 messages' },
            { value: 0, label: 'Whole chat' },
        ],
        help: 'How much of the story the lore writer sees. Whichever you pick, the excerpt '
            + 'is capped below - whole messages, newest first - so a long story is trimmed '
            + 'rather than making a request no model can take.',
    }));
    const excerptReadout = document.createElement('small');
    excerptReadout.className = 'notes';
    excerptReadout.style.cssText = 'display:block; margin:-2px 0 10px;';
    view.append(buildSettingNumber({
        key: 'loreCharBudget',
        advanced: true,
        label: 'Story Excerpt',
        suffix: 'characters',
        help: 'How much of the story is copied into the lore prompt, counted in characters - '
            + 'roughly four per token. Whole messages, newest first, until the next one will '
            + 'not fit. This is a single request and cannot be split into passes the way the '
            + 'history scan is, so the figure below is what one lore generation costs.',
        onChange: () => updateExcerptReadout(excerptReadout),
    }));
    updateExcerptReadout(excerptReadout);
    view.append(excerptReadout);
    view.append(buildSettingToggle({
        key: 'loreUseDataBank',
        label: 'Search the Data Bank',
        help: 'Look the character up in your Data Bank before writing, and give the writer '
            + 'what it finds. Needs SillyTavern\'s Vector Storage with Data Bank files '
            + 'enabled; its own chunk-count setting decides how much comes back. Searched '
            + 'by name. SillyTavern skips vectors for background requests like this one, '
            + 'so without this the writer never sees your Data Bank at all.',
    }));
    view.append(buildConnectionProfilePicker(null, {
        key: 'loreProfileId',
        scope: 'root',
        labelText: 'Lore Connection',
        fallbackLabel: 'Main API (same as chat)',
        noteText: 'Which connection writes lore entries. Separate from the tracker\'s: a '
            + 'small model chosen for returning JSON is not the one you want writing prose.',
        unavailableText: 'Connection Manager is not available, so lore is written by your '
            + 'main API. Enable the Connection Manager extension to choose another model.',
    }));
    view.append(buildLastLoreConnectionNote());
    view.append(buildSettingNumber({ key: 'loreMaxTokens', label: 'Lore Reply Budget',
        suffix: 'tokens', help: 'Maximum tokens the lore writer may reply with.' }));
}

function renderUnknownSpeakerSettings(view) {
    const autoFillTitle = document.createElement('h3');
    autoFillTitle.className = 'sillynpc-section-title';
    autoFillTitle.textContent = 'Automatic NPC Fill';
    view.append(autoFillTitle);
    const autoFillNote = document.createElement('p');
    autoFillNote.className = 'notes';
    autoFillNote.textContent = 'Creating an NPC from an unknown speaker writes missing description and lore fields together, then draws a portrait if enabled. Completed parts are kept if you retry.';
    view.append(autoFillNote);
    view.append(buildSettingToggle({
        key: 'autoPortraitOnFill',
        label: 'Draw Portrait Automatically',
        help: 'Draw and assign a portrait after automatic Fill when the NPC has none. Uses the generated age, appearance, and personality with your selected image source, which may be billed separately.',
    }));
}
