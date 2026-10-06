import { refreshExtensionEnabled } from '../../entry/entry-enabled.js';
import { renderStatsView } from '../shared/ui-stats.js';
import { getSettings } from '../../core/settings.js';
import { buildSettingToggle, buildSettingSlider } from '../shared/ui-shared.js';
import { setDebugLogging } from '../../core/constants.js';

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
        help: 'Turn off chat decorations, prompts, the HUD and background reading. Saved characters and tracker data are kept.',
        onChange: refreshExtensionEnabled,
    }));

    view.append(buildSettingToggle({
        key: 'devMode',
        label: 'Detailed Settings',
        help: 'Show request budgets, prompt depths, scan limits and other specialized controls.',
        onChange: () => rerender(),
    }));

    const sizeDetails = document.createElement('details');
    sizeDetails.className = 'sillynpc-customize';
    const sizeSummary = document.createElement('summary');
    sizeSummary.textContent = 'Customize menu size';
    sizeDetails.append(sizeSummary);
    sizeDetails.append(buildSettingSlider({ key: 'popupWidth', label: 'Menu Width', min: 20, max: 100, suffix: 'vw', help: 'Width relative to screen size.', onChange: () => applyPopupSize?.() }));
    sizeDetails.append(buildSettingSlider({ key: 'popupHeight', label: 'Menu Height', min: 20, max: 100, suffix: 'vh', help: 'Height relative to screen size.', onChange: () => applyPopupSize?.() }));
    view.append(sizeDetails);

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

    const addedView = document.createElement('div');
    addedView.id = 'sillynpc-stats-view';
    view.append(addedView);
    renderStatsView(addedView);
}
