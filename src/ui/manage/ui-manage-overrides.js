import { npcStatsFor } from '../../core/npc-templates.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { triggerReprocess } from '../../chat/chat.js';
import { escapeHtml } from '../../core/utils.js';
import { syncOverrideToActiveState } from '../../tracker/status-logic.js';
import { constrainNumericStat } from '../../tracker/numeric-stat-bounds.js';
import { buildChoiceSelect, isChoiceField } from '../shared/ui-shared.js';

export function renderOverridesSection(char, container) {
    if (!container) return;
    
    container.innerHTML = `
        <div class="sillynpc-aliases-header">
            <label>Initial Status Overrides</label>
            <small class="notes">Leave blank to use global default values.</small>
        </div>
    `;

    const stats = npcStatsFor(char, getSettings().statusTracker);
    if (stats.length === 0) {
        const p = document.createElement('p');
        p.className = 'notes';
        p.textContent = 'No character stats defined in Status Settings.';
        container.appendChild(p);
        return;
    }

    const grid = document.createElement('div');
    grid.className = 'sillynpc-overrides-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr';
    grid.style.gap = '8px';
    grid.style.marginTop = '8px';

    stats.forEach(stat => {
        const row = document.createElement('div');
        row.className = 'sillynpc-override-row';
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '10px';

        const label = document.createElement('div');
        label.style.flex = '0 0 80px';
        label.style.fontWeight = 'bold';
        label.textContent = stat.name;

        // Parse currentValue (e.g. "50/100" or "50")
        const currentValue = char.statusOverrides?.[stat.name] || '';
        const fixedNumeric = (stat.type === 'number' || stat.type === 'bar')
            && !String(currentValue || stat.defaultValue || '').includes('/');
        let valPart = currentValue;
        let maxPart = '';
        if (typeof currentValue === 'string' && currentValue.includes('/')) {
            const parts = currentValue.split('/');
            valPart = parts[0];
            maxPart = parts[1];
        }

        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.className = 'text_pole override-val-input';
        valInput.style.flex = '2';
        valInput.placeholder = `Val (Def: ${stat.defaultValue || ''})`;
        valInput.value = valPart;

        const slashLabel = document.createElement('span');
        slashLabel.textContent = '/';
        slashLabel.style.opacity = '0.5';

        const maxInput = document.createElement('input');
        maxInput.type = 'text';
        maxInput.className = 'text_pole override-max-input';
        maxInput.style.flex = '1';
        maxInput.placeholder = `Max (Def: ${stat.maxStatValue || ''})`;
        maxInput.value = maxPart;

        const updateOverride = () => {
            const v = valInput.value.trim();
            const m = fixedNumeric ? '' : maxInput.value.trim();
            
            if (!char.statusOverrides) char.statusOverrides = {};
            
            if (v === '' && m === '') {
                delete char.statusOverrides[stat.name];
            } else {
                const raw = m ? `${v}/${m}` : v;
                char.statusOverrides[stat.name] = constrainNumericStat(stat, raw, currentValue);
            }
            
            saveSettings();
            
            const finalValue = char.statusOverrides[stat.name] || '';
            if (fixedNumeric) valInput.value = String(finalValue).split('/')[0];
            syncOverrideToActiveState(char.name, stat.name, finalValue);
            triggerReprocess();
        };

        if (isChoiceField(stat)) {
            const select = buildChoiceSelect(stat.options, currentValue);
            select.style.flex = '3';
            select.addEventListener('change', () => {
                if (!char.statusOverrides) char.statusOverrides = {};
                const chosen = select.value;
                if (chosen === '') delete char.statusOverrides[stat.name];
                else char.statusOverrides[stat.name] = chosen;

                saveSettings();
                syncOverrideToActiveState(char.name, stat.name, chosen);
                triggerReprocess();
            });
            row.append(label, select);
            grid.appendChild(row);
            return;
        }

        valInput.addEventListener(fixedNumeric ? 'change' : 'input', updateOverride);
        if (!fixedNumeric) maxInput.addEventListener('input', updateOverride);

        row.append(label, valInput);
        if (!fixedNumeric) row.append(slashLabel, maxInput);
        grid.appendChild(row);
    });

    container.appendChild(grid);
}

export function buildAliasRow(char, index, refreshEditor) {
    const alias = char.aliases[index];
    const row = document.createElement('div');
    row.className = 'sillynpc-alias-row';
    row.innerHTML = `
        <input type="text" class="text_pole sillynpc-alias-pattern" value="${escapeHtml(alias.pattern)}" placeholder="Pattern">
        <label class="checkbox_label sillynpc-alias-regex"><input type="checkbox" ${alias.isRegex ? 'checked' : ''}> <span>Regex</span></label>
        <button type="button" class="menu_button delete-btn"><i class="fa-solid fa-trash"></i></button>
    `;
    const input = row.querySelector('input[type="text"]');
    const check = row.querySelector('input[type="checkbox"]');
    const validate = () => {
        input.classList.remove('sillynpc-invalid');
        if (alias.isRegex && alias.pattern) { try { new RegExp(alias.pattern); } catch { input.classList.add('sillynpc-invalid'); } }
    };
    input.addEventListener('input', () => { alias.pattern = input.value; saveSettings(); validate(); });
    check.addEventListener('change', () => { alias.isRegex = check.checked; saveSettings(); validate(); });
    row.querySelector('.delete-btn').addEventListener('click', () => { char.aliases.splice(index, 1); saveSettings(); refreshEditor(); });
    validate();
    return row;
}
