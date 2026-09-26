import { buildSettingSelect, buildSettingSlider } from './ui-shared.js';
import { buildTimeRulesSection } from './ui-tracker-time.js';
import { buildContextReport } from './ui-tracker-context.js';
import { applyCheckpointSchedule } from './status-logic.js';
import { openAdvancedSettingsPopup, openDashboardPopup } from './ui-tracker-popups.js';

export function renderTrackerCastAndRecovery({ container, settings, onApply, onChange, section }) {
    /* -- Time rules -------------------------------------------------------- */

    container.appendChild(buildTimeRulesSection(onApply));

    /* -- Who is in the scene ----------------------------------------------- */

    section('Who Is In The Scene');

    container.append(buildSettingSelect({
        key: 'statusTracker.castMode',
        label: 'Decided By',
        options: [
            { value: 'speakers', label: 'Whoever appears in the message' },
            { value: 'ai', label: "The AI's character list" },
        ],
        help: 'Detecting speakers is reliable and catches characters with no card. '
            + 'Relying on the AI to keep an exact list means a scene change can leave the '
            + 'previous cast behind.',
        onChange
    }));

    if (settings.castMode === 'speakers') {
        container.append(buildSettingSlider({
            key: 'statusTracker.castGraceMessages',
            label: 'Messages Before Leaving',
            min: 0,
            max: 10,
            step: 1,
            help: 'How long a character may go unmentioned before leaving the scene. '
                + 'Higher suits slow conversations; 0 removes anyone who did not appear '
                + 'in the latest message.',
            onChange: onApply
        }));
    }

    if (settings.castMode === 'ai') {
        container.append(buildSettingSelect({
            key: 'statusTracker.sceneBindingStat',
            advanced: true,
            label: 'Scene Binding Stat',
            options: [
                { value: '', label: 'None' },
                ...(settings.globalStats || []).map(stat => ({ value: stat.name, label: stat.name }))
            ],
            help: 'When this world stat changes, characters the AI did not mention are removed '
                + 'from the scene. Only used when the cast comes from the AI\'s list.',
            onChange: onApply
        }));
    }

    /* -- Chat size --------------------------------------------------------- */

    container.appendChild(buildContextReport(onChange));

    /* -- If something goes wrong ------------------------------------------- */

    section('If Something Goes Wrong');

    container.append(buildSettingSlider({
        key: 'statusTracker.systemAutoSaveMinutes',
        advanced: true,
        label: 'Save System State Every',
        min: 0, max: 120, step: 5, suffix: ' min',
        help: "0 turns it off. A system's stored copy is otherwise only rewritten when you "
            + 'switch away from it, so a system you never leave keeps whatever it held the '
            + 'last time you did. Saving on a timer keeps something recent to fall back to. '
            + 'A save that would be identical to the last one is skipped.',
        onChange: () => { onApply(); applyCheckpointSchedule(); },
    }));

    container.append(buildSettingSlider({
        key: 'statusTracker.systemCheckpointsKept',
        advanced: true,
        label: 'Saved States Kept',
        min: 1, max: 20, step: 1,
        help: 'Per system. Each holds a full copy of that system - its characters, item '
            + 'library, persona records and settings - so a large world costs real space in '
            + 'your settings file. Restore them from the System Manager.',
        onChange: onApply,
    }));

    container.append(buildSettingSlider({
        key: 'statusTracker.historyDepth',
        advanced: true,
        label: 'Undo Steps Kept',
        min: 1,
        max: 50,
        step: 1,
        help: 'Each step stores a copy of the tracker state in the chat file, so large '
            + 'values grow the chat.',
        onChange: onApply
    }));

    /* -- Buttons ----------------------------------------------------------- */

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '10px';
    btnRow.style.marginTop = '20px';
    btnRow.style.flexWrap = 'wrap';

    const dashBtn = document.createElement('button');
    dashBtn.type = 'button';
    dashBtn.className = 'menu_button';
    dashBtn.style.flex = '1';
    dashBtn.innerHTML = '<i class="fa-solid fa-gauge-high"></i> Open Session Dashboard';
    dashBtn.addEventListener('click', () => openDashboardPopup());

    const advBtn = document.createElement('button');
    advBtn.type = 'button';
    advBtn.className = 'menu_button';
    advBtn.style.flex = '1';
    advBtn.innerHTML = '<i class="fa-solid fa-code"></i> HTML & CSS Template';
    advBtn.addEventListener('click', () => openAdvancedSettingsPopup());

    btnRow.append(dashBtn, advBtn);
    container.appendChild(btnRow);
}
