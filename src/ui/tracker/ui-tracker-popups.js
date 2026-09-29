import { getSettings, saveSettings, defaultSettings } from '../../core/settings.js';
import { buildPromptEditor } from '../shared/ui-prompts.js';
import { promptById } from '../../prompts/prompts.js';
import { tidyTemplateLabels } from '../shared/ui-template-tidy.js';
import { buildSettingToggle, buildSettingTextArea, buildSettingSlider, buildSettingSelect, buildSettingNumber, updateExtensionTheme, repositionCloseButton } from '../shared/ui-shared.js';
import { loadStateFromMetadata, saveStateToMetadata, applyCheckpointSchedule, getHistoryEntries, restoreHistoryEntry } from '../../tracker/status-logic.js';
import { POPUP_TYPE, Popup } from '../../../../../../popup.js';
import { eventSource } from '../../../../../../events.js';
import { triggerReprocess } from '../../chat/chat.js';
import { updateHUD } from '../hud/ui-hud.js';
import { escapeHtml } from '../../core/utils.js';
import { cleanChatHistory, measureChatOverhead, estimateTokens } from '../../tracker/status-history.js';
import { buildConnectionProfilePicker } from '../settings/ui-connection-profiles.js';

export async function openAdvancedSettingsPopup() {
    const container = document.createElement('div');
    container.className = 'sillynpc sillynpc-manage'; // Use manage class for theme background
    container.style.padding = '20px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '20px';
    container.style.height = '100%';

    const templateField = buildSettingTextArea({ 
        key: 'statusTracker.template', 
        label: 'HTML Template', 
        help: 'Use {{StatName}} for global stats and {{#characters}}...{{/characters}} for characters.' 
    });
    container.append(templateField);

    // A label typed into the template cannot follow the field it names, so this offers to
    // take it out and let the field's own Format supply one instead.
    const tidyBtn = document.createElement('button');
    tidyBtn.type = 'button';
    tidyBtn.className = 'menu_button sillynpc-tidy-labels-btn';
    tidyBtn.innerHTML = '<i class="fa-solid fa-broom"></i> <span>Tidy labels</span>';
    tidyBtn.title = 'Find words written beside a field reference, like "HP [{{Health}}]", '
        + 'and offer to remove them so the label comes from the field.';
    tidyBtn.addEventListener('click', () => tidyTemplateLabels(() => {
        // The box on screen is still showing the text as it was a moment ago, and typing
        // into it afterwards would write the stale copy straight back.
        const box = templateField.querySelector('textarea');
        if (box) box.value = getSettings().statusTracker.template;
        triggerReprocess();
    }));
    container.append(tidyBtn);

    // A template written when references were placements has leftovers no cleanup makes
    // pretty. Replacing it is more predictable than surgery, and the old text is kept.
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'menu_button sillynpc-reset-layout-btn';
    resetBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> <span>Reset layout</span>';
    resetBtn.title = 'Replace the template with the default one, which holds the structure '
        + 'and lets your fields decide the rest. Your current template is kept.';
    resetBtn.addEventListener('click', async () => {
        const tracker = getSettings().statusTracker;
        const ok = await Popup.show.confirm('Reset the layout',
            'The template goes back to the default: the box structure, with your fields '
            + 'filling it in the order the builder lists them. Your current template is '
            + 'kept and can be pasted back from the backup.');
        if (!ok) return;

        tracker.templateBackup = tracker.template;
        tracker.template = defaultSettings.statusTracker.template;
        saveSettings();
        const box = templateField.querySelector('textarea');
        if (box) box.value = tracker.template;
        triggerReprocess();
        toastr.success('Layout reset. Your old template is kept as a backup.', 'SillyNPC');
    });
    container.append(resetBtn);

    container.append(buildSettingTextArea({ 
        key: 'statusTracker.customCSS', 
        label: 'Custom CSS', 
        help: 'Additional styles for your status box.' 
    }));

    const settings = getSettings();
    const isMobile = window.innerWidth <= 768;
    const width = isMobile ? 95 : (settings.popupWidth ?? 80);
    const height = isMobile ? 90 : (settings.popupHeight ?? 80);
    const visualContent = container;
    const popup = new Popup(container, POPUP_TYPE.DISPLAY, '', { 
        allowVerticalScrolling: true,
        onOpen: (p) => {
            if (p.dlg) {
                p.dlg.style.setProperty('width', `${width}vw`, 'important');
                p.dlg.style.setProperty('max-width', '98vw', 'important');
                p.dlg.style.setProperty('height', `${height}vh`, 'important');
                p.dlg.style.setProperty('max-height', '98vh', 'important');
                if (isMobile) p.dlg.style.setProperty('margin', '2vh auto', 'important');
            }
            updateExtensionTheme(container, p);
            repositionCloseButton(p, visualContent);
        }
    
    });
    await popup.show();
}

export async function openDashboardPopup() {
    const container = document.createElement('div');
    container.className = 'sillynpc sillynpc-manage';
    container.style.padding = '20px';
    container.style.height = '100%';
    
    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'Current Session Status (Manual Override)';
    container.appendChild(title);
    
    const dashboardContainer = document.createElement('div');
    dashboardContainer.appendChild(buildStatusDashboard());
    container.appendChild(dashboardContainer);
    
    const settings = getSettings();
    const isMobile = window.innerWidth <= 768;
    const width = isMobile ? 95 : (settings.popupWidth ?? 80);
    const height = isMobile ? 90 : (settings.popupHeight ?? 80);
    const visualContent = container;
    const popup = new Popup(container, POPUP_TYPE.DISPLAY, '', { 
        allowVerticalScrolling: true,
        onOpen: (p) => {
            if (p.dlg) {
                p.dlg.style.setProperty('width', `${width}vw`, 'important');
                p.dlg.style.setProperty('max-width', '98vw', 'important');
                p.dlg.style.setProperty('height', `${height}vh`, 'important');
                p.dlg.style.setProperty('max-height', '98vh', 'important');
                if (isMobile) p.dlg.style.setProperty('margin', '2vh auto', 'important');
            }
            updateExtensionTheme(container, p);
            repositionCloseButton(p, visualContent);
        }
    });
    await popup.show();
}

function buildStatusDashboard() {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-status-dashboard';
    wrap.style.padding = '10px';
    wrap.style.background = 'var(--sillynpc-bg-secondary)';
    wrap.style.borderRadius = '8px';
    
    const state = loadStateFromMetadata();
    const settings = getSettings().statusTracker;
    
    const globalSection = document.createElement('div');
    globalSection.innerHTML = '<strong>Global Stats</strong>';
    settings.globalStats.forEach(stat => {
        const key = stat.name;
        const value = state.global[key] || stat.defaultValue || '';
        const row = document.createElement('div');
        row.className = 'sillynpc-setting-row';
        row.style.margin = '5px 0';
        row.innerHTML = `<span style="width:100px; display:inline-block">${escapeHtml(key)}:</span> <input type="text" class="text_pole" style="width:200px" value="${escapeHtml(value)}">`;
        row.querySelector('input').addEventListener('blur', (e) => {
            state.global[key] = e.target.value;
            saveStateToMetadata(state, { label: 'Manual edit' });
            eventSource.emit('sillynpc-status-updated', state);
        });
        globalSection.appendChild(row);
    });

    const playerSection = document.createElement('div');
    playerSection.style.marginTop = '15px';
    playerSection.innerHTML = '<strong>Player Stats</strong>';
    settings.playerStats.forEach(stat => {
        const key = stat.name;
        const value = state.player.stats[key] || stat.defaultValue || '';
        const row = document.createElement('div');
        row.className = 'sillynpc-setting-row';
        row.style.margin = '5px 0';
        row.innerHTML = `<span style="width:100px; display:inline-block">${escapeHtml(key)}:</span> <input type="text" class="text_pole" style="width:200px" value="${escapeHtml(value)}">`;
        row.querySelector('input').addEventListener('blur', (e) => {
            state.player.stats[key] = e.target.value;
            saveStateToMetadata(state, { label: 'Manual edit' });
            eventSource.emit('sillynpc-status-updated', state);
        });
        playerSection.appendChild(row);
    });
    
    const charSection = document.createElement('div');
    charSection.style.marginTop = '15px';
    charSection.innerHTML = '<strong>Characters</strong>';
    state.characters.forEach((char, charIdx) => {
        const charWrap = document.createElement('div');
        charWrap.style.marginBottom = '10px';
        charWrap.style.padding = '5px';
        charWrap.style.border = '1px solid var(--sillynpc-border)';
        charWrap.innerHTML = `<div><strong>${escapeHtml(char.name)}</strong></div>`;
        
        settings.npcStats.forEach(stat => {
            const key = stat.name;
            const value = char.stats[key] || stat.defaultValue || '';
            const row = document.createElement('div');
            row.className = 'sillynpc-setting-row';
            row.style.margin = '2px 0';
            row.innerHTML = `<span style="width:100px; display:inline-block">${escapeHtml(key)}:</span> <input type="text" class="text_pole" style="width:150px" value="${escapeHtml(value)}">`;
            row.querySelector('input').addEventListener('blur', (e) => {
                char.stats[key] = e.target.value;
                saveStateToMetadata(state, { label: 'Manual edit' });
                eventSource.emit('sillynpc-status-updated', state);
            });
            charWrap.appendChild(row);
        });
        charSection.appendChild(charWrap);
    });

    const historySection = document.createElement('div');
    historySection.style.marginTop = '15px';
    historySection.innerHTML = '<strong>Undo History</strong>';
    const entries = getHistoryEntries();
    if (entries.length === 0) {
        const none = document.createElement('div');
        none.className = 'notes';
        none.style.opacity = '0.6';
        none.textContent = 'No changes recorded yet in this chat.';
        historySection.appendChild(none);
    } else {
        // Newest first reads better, but restoreHistoryEntry indexes the raw array.
        entries.slice().reverse().forEach((entry, revIdx) => {
            const index = entries.length - 1 - revIdx;
            const row = document.createElement('div');
            row.className = 'sillynpc-setting-row';
            row.style.margin = '4px 0';
            row.style.gap = '10px';

            const when = new Date(entry.timestamp);
            const label = document.createElement('span');
            label.style.flex = '1';
            label.textContent = `${entry.label} - ${when.toLocaleTimeString()}`;

            const where = document.createElement('small');
            where.style.opacity = '0.6';
            const loc = entry.state?.global ? Object.values(entry.state.global)[0] : '';
            where.textContent = loc ? String(loc) : '';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'menu_button';
            btn.textContent = 'Restore';
            btn.title = 'Return to this point, discarding everything after it';
            btn.addEventListener('click', async () => {
                const ok = await Popup.show.confirm('Restore this point?',
                    `Everything recorded after "${entry.label}" will be discarded.`);
                if (!ok) return;
                restoreHistoryEntry(index);
                const dashRoot = wrap.parentElement;
                dashRoot.replaceChildren();
                dashRoot.appendChild(buildStatusDashboard());
            });

            row.append(label, where, btn);
            historySection.appendChild(row);
        });
    }

    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'menu_button';
    refreshBtn.style.marginTop = '10px';
    refreshBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Reload from Metadata';
    refreshBtn.addEventListener('click', () => {
        const dashRoot = wrap.parentElement;
        dashRoot.replaceChildren();
        dashRoot.appendChild(buildStatusDashboard());
    });
    
    wrap.append(globalSection, playerSection, charSection, historySection, refreshBtn);
    return wrap;
}
