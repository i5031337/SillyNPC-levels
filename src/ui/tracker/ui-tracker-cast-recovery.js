import { buildTimeRulesSection } from './ui-tracker-time.js';
import { buildContextReport } from './ui-tracker-context.js';
import { openAdvancedSettingsPopup, openDashboardPopup } from './ui-tracker-popups.js';

export function renderTrackerCastAndRecovery({ container, onApply, onChange }) {
    /* -- Time rules -------------------------------------------------------- */

    container.appendChild(buildTimeRulesSection(onApply));

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
