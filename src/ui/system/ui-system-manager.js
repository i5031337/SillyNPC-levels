import { getSettings } from '../../core/settings.js';
import { offerDownload } from '../../core/utils.js';
import { updateAllExtensionThemes } from '../shared/ui-shared.js';
import { deleteSystemPreset, importSystemPreset, getActiveSystem, getChatSystem, chatHasStarted, setActiveSystem, createSystem } from '../../tracker/status-logic.js';
import { Popup } from '../../../../../../popup.js';
import { triggerReprocess } from '../../chat/chat.js';
import { escapeHtml } from '../../core/utils.js';
import { openItemLibrary } from '../collections/ui-item-library.js';
import { exportWorldCharacters } from '../../characters/world-character-export.js';
import { carriesNpcStat } from '../../tracker/stat-persistence.js';
import { normalizeSystemDefinition } from '../../core/system-schema.js';

/**
 * System Manager: importing, exporting, and switching reusable Systems.
 *
 * Split out of status-settings.js. What a System is made of is System Builder's job.
 */

function exportSystem(name) {
    const settings = getSettings();
    const profile = settings.statusTracker.presets?.[name];
    if (!profile) return;
    
    offerDownload(profile.definition || normalizeSystemDefinition(profile, { name }),
        `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_system.json`);
}

export function buildSystemManager(onRefresh) {
    const wrap = document.createElement('div');
    const settings = getSettings();
    const presets = settings.statusTracker.presets || {};
    const presetNames = Object.keys(presets);
    const chatSystem = chatHasStarted() ? (getChatSystem() || getActiveSystem()) : null;

    const listWrap = document.createElement('div');
    listWrap.style.marginBottom = '20px';
    listWrap.style.maxHeight = '300px';
    listWrap.style.overflowY = 'auto';
    listWrap.style.border = '1px solid var(--sillynpc-border)';
    listWrap.style.borderRadius = '5px';

    if (presetNames.length === 0) {
        listWrap.innerHTML = `<div style="padding:15px; text-align:center; opacity:0.5;">No systems in library.</div>`;
    } else {
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        
        presetNames.forEach(name => {
            const profile = presets[name];
            const row = document.createElement('tr');
            row.style.borderBottom = '1px solid var(--sillynpc-border)';
            
            const nameCell = document.createElement('td');
            nameCell.style.padding = '8px';
            const detail = profile.metadata?.description || 'reusable rules';
            nameCell.innerHTML = `<div style="font-weight:bold">${escapeHtml(name)}`
                + (name === getActiveSystem() ? ' <small style="opacity:0.6">(in use)</small>' : '')
                + `</div><small style="opacity:0.6">${escapeHtml(detail)}</small>`;
            
            const actionsCell = document.createElement('td');
            actionsCell.style.padding = '8px';
            actionsCell.style.textAlign = 'right';
            actionsCell.style.whiteSpace = 'nowrap';
            
            // Which system you are in used to be unknowable: the library listed four and
            // marked none. The radio both shows it and is how you change it.
            const activeCell = document.createElement('td');
            activeCell.style.cssText = 'padding:8px; width:1%;';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'sillynpc-active-system';
            radio.checked = name === getActiveSystem();
            radio.disabled = Boolean(chatSystem && chatSystem !== name);
            radio.title = radio.disabled ? `This chat belongs to "${chatSystem}"`
                : radio.checked ? 'In use' : `Switch to "${name}"`;
            radio.addEventListener('change', () => {
                if (!radio.checked) return;
                // Save the active rules before selecting another System.
                if (!setActiveSystem(name)) {
                    onRefresh();
                    return;
                }
                updateAllExtensionThemes();
                onRefresh();
                triggerReprocess();
            });
            activeCell.append(radio);

            const expBtn = document.createElement('button');
            expBtn.className = 'menu_button';
            expBtn.title = 'Export to JSON';
            expBtn.innerHTML = '<i class="fa-solid fa-file-export"></i>';
            expBtn.addEventListener('click', () => exportSystem(name));

            const charsBtn = document.createElement('button');
            charsBtn.className = 'menu_button';
            charsBtn.textContent = 'Export World Characters';
            charsBtn.title = 'Export reusable cards and NPCs in every chat assigned to this System.';
            charsBtn.addEventListener('click', async () => {
                charsBtn.disabled = true;
                try {
                    const payload = await exportWorldCharacters(name);
                    if (!payload.characters.length) {
                        toastr.info(`No characters found for "${name}".`, 'SillyNPC');
                        return;
                    }
                    const defs = name === getActiveSystem()
                        ? getSettings().statusTracker.npcStats
                        : (profile.config?.statusTracker?.npcStats || profile.config?.npcStats || []);
                    const innate = (defs || []).filter(carriesNpcStat)
                        .map(stat => stat.name);
                    const confirmed = await Popup.show.confirm('Export World Characters',
                        `${payload.characters.length} characters from reusable cards and assigned chats. `
                        + `Advancement and locked fields carried: ${innate.join(', ') || 'none'}. `
                        + 'Turn stats, conditions and inventory reset on import. Export this file?');
                    if (!confirmed) return;
                    offerDownload(payload,
                        `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_characters.json`);
                    toastr.success(`Exported ${payload.characters.length} characters.`, 'SillyNPC');
                } catch (err) {
                    toastr.error(String(err?.message || err), 'SillyNPC');
                } finally {
                    charsBtn.disabled = false;
                }
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'menu_button';
            delBtn.title = 'Delete';
            delBtn.style.color = 'var(--red)';
            delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            delBtn.addEventListener('click', async () => {
                // The active configuration still needs its System.
                if (name === getActiveSystem()) {
                    toastr.info('Switch to another system before deleting this one.', 'SillyNPC');
                    return;
                }
                if (await Popup.show.confirm('Delete system', `Delete the saved system "${name}"?`)) {
                    deleteSystemPreset(name);
                    onRefresh();
                }
            });

            actionsCell.append(expBtn, charsBtn, delBtn);
            row.append(activeCell, nameCell, actionsCell);
            table.appendChild(row);
        });
        listWrap.appendChild(table);
    }

    // Global Actions
    const globalActions = document.createElement('div');
    globalActions.style.display = 'flex';
    globalActions.style.gap = '10px';
    globalActions.style.flexWrap = 'wrap';

    // "Save current as new" asked you to remember to do it, and every new ruleset began
    // as a copy of the last one. Switching now captures on the way out, so this is only
    // about starting something genuinely new.
    const newBtn = document.createElement('button');
    newBtn.className = 'menu_button';
    newBtn.style.flex = '1';
    newBtn.innerHTML = '<i class="fa-solid fa-plus"></i> New System';
    newBtn.disabled = Boolean(chatSystem);
    newBtn.title = chatSystem ? 'Open a new chat before choosing a different System.'
        : 'Start a new System from the defaults.';
    newBtn.addEventListener('click', async () => {
        const name = (await Popup.show.input('New system', 'Name for this system:'))?.trim();
        if (!name) return;
        if (!createSystem(name)) {
            toastr.error(`A system called "${name}" already exists.`, 'SillyNPC');
            return;
        }
        updateAllExtensionThemes();
        onRefresh();
        triggerReprocess();
    });

    const importBtn = document.createElement('button');
    importBtn.className = 'menu_button';
    importBtn.style.flex = '1';
    importBtn.innerHTML = '<i class="fa-solid fa-file-import"></i> Import JSON';
    importBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const text = await file.text();
                    importSystemPreset(text);
                    onRefresh();
                } catch (err) {
                    toastr.error(`Failed to import system: ${err.message}`, 'SillyNPC');
                }
            }
        };
        input.click();
    });

    const libraryBtn = document.createElement('button');
    libraryBtn.className = 'menu_button';
    libraryBtn.style.flex = '1';
    libraryBtn.innerHTML = '<i class="fa-solid fa-book"></i> Entry Library';
    libraryBtn.title = 'View and clean up what the extension remembers between chats - items, skills, spells, whatever your collections hold';
    libraryBtn.addEventListener('click', () => openItemLibrary());

    globalActions.append(newBtn, importBtn, libraryBtn);
    wrap.append(listWrap, globalActions);
    return wrap;
}
