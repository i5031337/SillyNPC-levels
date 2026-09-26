import { clearRuns } from './default-portraits.js';
import { triggerReprocess } from './chat.js';
import { getSettings, saveSettings } from './settings.js';
import { pickAndProcessImages, resolveImageFolder, describeSaveDestination } from './utils.js';
import { promptListAvailable } from './prompt-slot.js';
import { applyDialogueFormatPrompt } from './dialogue-format.js';
import { applyNarratorRulesPrompt } from './narrator-rules.js';
import { buildSettingSelect, buildSettingToggle, buildSettingTextArea, buildSettingSlider, buildSettingNumber, updateAllExtensionThemes, applyPortraitFraming, applySpeechPadding } from './ui-shared.js';
import { buildPromptEditor, buildPromptBudget } from './ui-prompts.js';
import { renderBanList } from './ui-banlist.js';
import { promptById } from './prompts.js';
import { world_names } from '../../../../world-info.js';
import { extension_settings } from '../../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../popup.js';
import { LOG_PREFIX, NARRATOR_RULES_PROMPT, SILLYNPC_THEMES, GEMINI_IMAGE_MODELS, PORTRAIT_SHAPES, debugLog, setDebugLogging } from './constants.js';
import { buildLoreExcerpt, resolvePortraitShape, getLastLoreConnection, resolveImageSecretId, scanFolderForCharacterImages, persistGeneratedImage, findOrphanedImages, deleteImageFiles } from './api.js';
import { getSecretLabelById } from '../../../../secrets.js';
import { getRequestHeaders } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { buildConnectionProfilePicker } from './ui-connection-profiles.js';

export function renderAdvancedView(view, handlers = {}) {
    if (!view) return;
    const { applyPopupSize, onExport, onImport } = handlers;

    view.replaceChildren();
    // Dev mode changes which controls exist, so the panel is drawn again rather than left
    // showing the answer to the previous question.
    const rerender = () => renderAdvancedView(view, handlers);

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'SillyNPC';
    view.appendChild(title);

    view.append(buildSettingToggle({
        key: 'enabled',
        label: 'Enable SillyNPC',
        help: 'The master switch. Off, nothing is decorated, no prompt is sent and the '
            + 'tracker reads nothing - your characters and everything they hold are kept.',
        onChange: () => triggerReprocess(),
    }));

    view.append(buildSettingToggle({
        key: 'devMode',
        label: 'Show Every Setting',
        help: 'Eighteen settings are hidden to begin with: reply budgets, transcript sizes, '
            + 'prompt depths, and the two that can lose an update if set wrong. Their '
            + 'defaults are right until something specific goes wrong, and meeting all '
            + 'eighty-one at once is how the useful ones get lost among them. Nothing is '
            + 'removed - this shows them again, on every tab.',
        onChange: () => rerender(),
    }));

    const sizeHeading = document.createElement('h3');
    sizeHeading.className = 'sillynpc-section-title';
    sizeHeading.style.marginTop = '20px';
    sizeHeading.textContent = 'Menu Size';
    view.append(sizeHeading);

    view.append(buildSettingSlider({ key: 'popupWidth', label: 'Menu Width', min: 20, max: 100, suffix: 'vw', help: 'Width relative to screen size.', onChange: () => applyPopupSize?.() }));
    view.append(buildSettingSlider({ key: 'popupHeight', label: 'Menu Height', min: 20, max: 100, suffix: 'vh', help: 'Height relative to screen size.', onChange: () => applyPopupSize?.() }));

    const backupHeading = document.createElement('h3');
    backupHeading.className = 'sillynpc-section-title';
    backupHeading.style.marginTop = '20px';
    backupHeading.textContent = 'Backup';
    view.append(backupHeading);

    const backupNote = document.createElement('p');
    backupNote.className = 'notes sillynpc-tab-intro';
    backupNote.textContent = 'Everything at once - every character, every setting, every '
        + 'System. Importing one replaces all of it, so this is a backup rather than a way '
        + 'to share: to send somebody a single character, use Export on their page.';
    view.append(backupNote);

    const backupRow = document.createElement('div');
    backupRow.className = 'sillynpc-backup-row';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'menu_button';
    exportBtn.innerHTML = '<i class="fa-solid fa-file-export"></i> <span>Export everything</span>';
    exportBtn.addEventListener('click', () => onExport?.());

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'menu_button';
    importBtn.innerHTML = '<i class="fa-solid fa-file-import"></i> <span>Import a backup</span>';
    importBtn.addEventListener('click', () => onImport?.());

    backupRow.append(exportBtn, importBtn);
    view.append(backupRow);

    const troubleshooting = document.createElement('h3');
    troubleshooting.className = 'sillynpc-section-title';
    troubleshooting.style.marginTop = '20px';
    troubleshooting.textContent = 'Troubleshooting';
    view.append(troubleshooting);

    view.append(buildSettingToggle({
        key: 'debugLogging',
        label: 'Log Requests To The Console',
        help: 'Prints one line in the browser console for every request SillyNPC makes - '
            + 'lore, extraction and portraits - naming the connection, the model and which '
            + 'API key it used. Off by default because extraction runs after every message. '
            + 'Open the console with F12.',
        onChange: () => setDebugLogging(getSettings().debugLogging),
    }));
}

/**
 * The pool of faces for speakers who have none.
 *
 * Was one picture and a Browse button. One picture meant every stranger in the story wore
 * the same face, which is worse than no picture at all - it says these are all one person.
 *
 * @param {HTMLElement} view
 * @param {() => void} rerender
 */
