import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { POPUP_TYPE, Popup } from '../../../../popup.js';
import { extensionName, LOG_PREFIX, PROFILE_FIELDS } from './constants.js';
import { getSettings, saveSettings, exportSettingsData, importSettingsData } from './settings.js';
import { getLibraryCharacters, isChatCharacter } from './character-repository.js';
import { 
    createCharacter, 
    deleteCharacter, 
    findCharacter, 
    reorderCharacters,
    moveCharacterToCategory,
    getAllCategories,
    deleteCategory,
    createCategory,
    renameCategory,
    moveCategory,
    getChatCast,
    setChatCast,
    isCharacterInChat,
    addCharacterToChat,
    instantiateWorldCharacter,
    UNCATEGORISED
} from './characters.js';
import { reprocessAllMessages, triggerReprocess, chatRenderSignature } from './chat.js';
import { syncAllLorebooks, renameLorebookEntry } from './lorebook.js';
import { escapeHtml, offerDownload } from './utils.js';
import { buildPortraitBlock, openLightbox } from './ui-portrait.js';
import { taggedFields, getImageTag, setImageTag, tagsFromFilename, valuesByField }
    from './image-tags.js';
import { folderFor, refreshCharacterImages, moveFolder } from './character-images.js';
import { renderLorebookSection, resetLorebookState } from './ui-lorebook-section.js';
import { renderProfileView, renderProfileFields } from './ui-profile.js';
import { renderThreadsView } from './ui-threads.js';
import { fillCharacter } from './ui-fill.js';
import { fillProfile } from './character-fill.js';
import { renderAppearanceView, renderWritingRulesView, renderAdvancedView, renderGenerationSettingsView } from './ui-settings-tabs.js';
import { renderPromptsView } from './ui-prompts.js';
import { renderStatsView } from './ui-stats.js';
import { renderStatusView } from './ui-tracker-settings.js';
import { renderHudView } from './ui-hud-settings.js';
import { buildSystemBuilder } from './ui-system-builder.js';
import { buildSystemManager } from './ui-system-manager.js';
import { syncOverrideToActiveState, loadStateFromMetadata, hasOpenChat } from './status-logic.js';
import { renderCollectionUI, attachCollectionListeners, resolveCollectionTarget, persistCollectionEdit, updateExtensionTheme, repositionCloseButton, hideEmptySections } from './ui-shared.js';
import { buildBulkBar, buildBulkCheckbox, spliceIndexes } from './ui-bulk-select.js';
import { buildChoiceSelect, isChoiceField } from './ui-shared.js';
import { exportCharacterFile, importCharacterFile } from './ui-transfer.js';
import { buildGridFilterRow } from './ui-grid-filter.js';
import { buildSettingsSearch, buildSettingsIndex } from './ui-settings-search.js';
import { makeActivatable } from './utils.js';

/** @type {Popup|null} */
import { manageState } from './ui-manage-state.js';
import { renderEditor } from './ui-manage-editor.js';

export function renderOverridesSection(char, container) {
    if (!container) return;
    
    container.innerHTML = `
        <div class="sillynpc-aliases-header">
            <label>Initial Status Overrides</label>
            <small class="notes">Leave blank to use global default values.</small>
        </div>
    `;

    const stats = getSettings().statusTracker.npcStats || [];
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
            const m = maxInput.value.trim();
            
            if (!char.statusOverrides) char.statusOverrides = {};
            
            if (v === '' && m === '') {
                delete char.statusOverrides[stat.name];
            } else if (m !== '') {
                char.statusOverrides[stat.name] = `${v}/${m}`;
            } else {
                char.statusOverrides[stat.name] = v;
            }
            
            saveSettings();
            
            const finalValue = char.statusOverrides[stat.name] || '';
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

        valInput.addEventListener('input', updateOverride);
        maxInput.addEventListener('input', updateOverride);

        row.append(label, valInput, slashLabel, maxInput);
        grid.appendChild(row);
    });

    container.appendChild(grid);
}

export function buildAliasRow(char, index) {
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
    row.querySelector('.delete-btn').addEventListener('click', () => { char.aliases.splice(index, 1); saveSettings(); renderEditor(); });
    validate();
    return row;
}

