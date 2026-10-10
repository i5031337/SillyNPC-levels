import { getContext } from '../../../../../../st-context.js';
import { npcStatsFor } from '../../core/npc-templates.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { triggerReprocess } from '../../chat/chat.js';
import { escapeHtml } from '../../core/utils.js';
import { syncOverrideToActiveState, loadStateFromMetadata, applyUpdate, getCurrentPersonaKey } from '../../tracker/status-logic.js';
import { constrainNumericStat, isPoolStat } from '../../tracker/numeric-stat-bounds.js';
import { buildChoiceSelect, isChoiceField } from '../shared/ui-shared.js';

export function renderOverridesSection(char, container) {
    if (!container) return;
    
    container.innerHTML = char.isPlayer ? '' : `
        <div class="sillynpc-aliases-header">
            <small class="notes">Leave blank to use global default values.</small>
        </div>
    `;

    const tracker = getSettings().statusTracker;
    const origin = char.isPlayer ? { metadata: getContext().chatMetadata,
        chatId: getContext().getCurrentChatId?.(), personaKey: getCurrentPersonaKey(), system: getSettings().activeSystem } : null;
    const canWrite = () => !origin || (getContext().chatMetadata === origin.metadata
        && getContext().getCurrentChatId?.() === origin.chatId && getCurrentPersonaKey() === origin.personaKey
        && getSettings().activeSystem === origin.system);
    const stats = char.isPlayer ? tracker.playerStats : npcStatsFor(char, tracker);
    const readStat = stat => char.isPlayer
        ? Object.entries(loadStateFromMetadata().player?.stats || {})
            .find(([name]) => name.toLowerCase() === stat.name.toLowerCase())?.[1] ?? stat.defaultValue ?? ''
        : char.statusOverrides?.[stat.name] ?? '';
    const writeStat = (stat, value) => {
        if (!canWrite()) return;
        if (char.isPlayer) {
            applyUpdate({ player: { stats: { [stat.name]: value } } }, { label: 'Edited on the sheet', verbatim: true });
        } else {
            char.statusOverrides ||= {};
            if (value === '') delete char.statusOverrides[stat.name];
            else char.statusOverrides[stat.name] = value;
            saveSettings();
            syncOverrideToActiveState(char.name, stat.name, value);
            triggerReprocess();
        }
    };
    if (stats.length === 0) {
        const p = document.createElement('p');
        p.className = 'notes';
        p.textContent = 'No stats assigned to this character in the active System.';
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

        let currentValue = readStat(stat);
        const numeric = stat.type === 'number' || stat.type === 'bar';
        const pool = numeric && isPoolStat(stat);
        const fixedNumeric = numeric && !pool;
        const defaultParts = pool ? String(stat.defaultValue ?? '').split('/') : [stat.defaultValue ?? ''];
        const defaultValue = String(defaultParts[0]).trim();
        const defaultMax = defaultParts[1]?.trim() ?? stat.maxStatValue ?? '';
        let valPart = currentValue;
        let maxPart = '';
        if (pool && typeof currentValue === 'string' && currentValue.includes('/')) {
            const parts = currentValue.split('/');
            valPart = parts[0];
            maxPart = parts[1];
        }

        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.className = 'text_pole override-val-input';
        valInput.style.flex = '2';
        valInput.placeholder = `Val (Def: ${defaultValue})`;
        valInput.value = valPart;

        const slashLabel = document.createElement('span');
        slashLabel.textContent = '/';
        slashLabel.style.opacity = '0.5';

        const maxInput = document.createElement('input');
        maxInput.type = 'text';
        maxInput.className = 'text_pole override-max-input';
        maxInput.style.flex = '1';
        maxInput.placeholder = `Max (Def: ${defaultMax})`;
        maxInput.value = maxPart;

        const updateOverride = () => {
            if (!canWrite()) return;
            const v = valInput.value.trim();
            const m = pool ? maxInput.value.trim() : '';
            
            const raw = m ? `${v}/${m}` : v;
            const finalValue = v === '' && m === '' ? '' : constrainNumericStat(stat, raw, currentValue);
            writeStat(stat, finalValue);
            currentValue = readStat(stat);
            if (char.isPlayer) {
                const parts = String(currentValue).split('/');
                valInput.value = parts[0];
                maxInput.value = pool ? parts[1] || '' : '';
            } else if (fixedNumeric) valInput.value = String(currentValue);

        };

        if (isChoiceField(stat)) {
            const select = buildChoiceSelect(stat.options, currentValue);
            select.style.flex = '3';
            select.addEventListener('change', () => {
                writeStat(stat, select.value);
            });
            row.append(label, select);
            grid.appendChild(row);
            return;
        }

        if (char.isPlayer) {
            let saved = `${valInput.value}/${maxInput.value}`;
            const commit = () => {
                const next = `${valInput.value}/${maxInput.value}`;
                if (next === saved) return;
                updateOverride();
                saved = `${valInput.value}/${maxInput.value}`;
            };
            row.classList.add('sillynpc-pending-stat');
            row.commitStatEdit = commit;
            valInput.addEventListener('change', commit);
            if (pool) maxInput.addEventListener('change', commit);
        } else {
            valInput.addEventListener(fixedNumeric ? 'change' : 'input', updateOverride);
            if (pool) maxInput.addEventListener('input', updateOverride);
        }

        row.append(label, valInput);
        if (pool) row.append(slashLabel, maxInput);
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

/** Commit complete readings before a tab switch or popup removes focused inputs. */
export function commitStatEdits(container) {
    container?.querySelectorAll('.sillynpc-pending-stat').forEach(row => row.commitStatEdit());
}
