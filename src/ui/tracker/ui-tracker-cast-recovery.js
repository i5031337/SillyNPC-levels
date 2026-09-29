import { buildSettingSelect, buildSettingSlider } from '../shared/ui-shared.js';
import { buildTimeRulesSection } from './ui-tracker-time.js';
import { buildContextReport } from './ui-tracker-context.js';
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
