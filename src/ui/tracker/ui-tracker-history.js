import { getSettings, saveSettings, defaultSettings } from '../../core/settings.js';
import { buildPromptEditor } from '../shared/ui-prompts.js';
import { promptById } from '../../prompts/prompts.js';
import { tidyTemplateLabels } from '../shared/ui-template-tidy.js';
import { buildSettingToggle, buildSettingTextArea, buildSettingSlider, buildSettingSelect, buildSettingNumber, updateExtensionTheme, repositionCloseButton } from '../shared/ui-shared.js';
import { loadStateFromMetadata, saveStateToMetadata, syncPlayerToMaster, applyCheckpointSchedule, getHistoryEntries, restoreHistoryEntry } from '../../tracker/status-logic.js';
import { POPUP_TYPE, Popup } from '../../../../../../popup.js';
import { eventSource } from '../../../../../../events.js';
import { triggerReprocess } from '../../chat/chat.js';
import { updateHUD } from '../hud/ui-hud.js';
import { escapeHtml } from '../../core/utils.js';
import { cleanChatHistory, measureChatOverhead, estimateTokens } from '../../tracker/status-history.js';
import { buildConnectionProfilePicker } from '../settings/ui-connection-profiles.js';

export function buildHistoryNoteFields(settings, onApply) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    wrap.dataset.setting = 'statusTracker.historyNoteSkip';

    const label = document.createElement('label');
    label.className = 'sillynpc-setting-row';
    label.style.fontWeight = 'bold';
    label.textContent = 'Fields In The Note';
    wrap.append(label);

    const row = document.createElement('div');
    row.className = 'sillynpc-setting-row';
    row.style.flexWrap = 'wrap';
    row.style.gap = '10px';

    const skipped = () => (settings.historyNoteSkip || []).map(name => String(name).toLowerCase());
    for (const stat of settings.globalStats || []) {
        const name = String(stat?.name ?? '').trim();
        if (!name) continue;

        const tick = document.createElement('label');
        tick.className = 'checkbox_label';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !skipped().includes(name.toLowerCase());
        box.dataset.field = name;
        box.addEventListener('change', () => {
            const without = (settings.historyNoteSkip || [])
                .filter(other => String(other).toLowerCase() !== name.toLowerCase());
            settings.historyNoteSkip = box.checked ? without : [...without, name];
            onApply();
        });
        tick.append(box, document.createTextNode(` ${name}`));
        row.append(tick);
    }
    wrap.append(row);

    const note = document.createElement('small');
    note.className = 'notes';
    note.textContent = (settings.globalStats || []).length
        ? 'A field you untick is left out of the notes and nothing else. Untick them all and no '
            + 'notes are sent. A world field added later is included on its own.'
        : 'No world fields to show yet - add one in System Builder.';
    wrap.append(note);
    return wrap;
}

/**
 * Where the tracker box goes.
 *
 * Two settings used to ask this: a toggle for whether older messages get one, and a
 * select for above or below. They were always answered together and never made sense
 * apart, so they are one question with four answers.
 */
export function buildPlacementPicker(settings, onApply) {
    const KEY = 'sillynpc-placement';
    const value = (settings.showOnlyAtBottom === false ? 'every-' : 'last-')
        + (settings.renderPosition === 'top' ? 'top' : 'bottom');

    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';

    const row = document.createElement('div');
    row.className = 'sillynpc-setting-row';
    const label = document.createElement('label');
    label.className = 'sillynpc-setting-label';
    label.textContent = 'Where To Show It';

    const select = document.createElement('select');
    select.className = 'text_pole';
    select.id = KEY;
    for (const [v, text] of [
        ['last-bottom', 'Below the last message'],
        ['last-top', 'Above the last message'],
        ['every-bottom', 'Below every message'],
        ['every-top', 'Above every message'],
    ]) {
        const option = document.createElement('option');
        option.value = v;
        option.textContent = text;
        option.selected = v === value;
        select.appendChild(option);
    }
    select.addEventListener('change', () => {
        const st = getSettings().statusTracker;
        st.showOnlyAtBottom = select.value.startsWith('last-');
        st.renderPosition = select.value.endsWith('top') ? 'top' : 'bottom';
        onApply();
    });

    row.append(label, select);
    wrap.appendChild(row);

    const help = document.createElement('small');
    help.className = 'notes';
    help.style.cssText = 'margin-top:4px; display:block;';
    help.textContent = 'Under every message, each one shows the values as they stood at '
        + 'that point in the story rather than today’s.';
    wrap.appendChild(help);

    return wrap;
}


/**
 * Shows how much of the current chat is tracker data, and offers to remove it.
 *
 * The extension used to hide its status blocks in the DOM but leave them in the stored
 * message, so they were re-sent on every later turn. On a real 317-message chat that came
 * to 71% of the entire transcript. New messages are cleaned automatically; this recovers
 * what earlier ones left behind.
 */
