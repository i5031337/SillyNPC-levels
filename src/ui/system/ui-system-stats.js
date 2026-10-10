import { fieldTargets, fieldAssignmentConflicts } from '../../core/system-fields.js';
import { isPoolStat } from '../../tracker/numeric-stat-bounds.js';
import { attachRangeValidation } from './ui-system-range.js';
import { normalizeSystemDefinition } from '../../core/system-schema.js';
import { buildTargetsEditor } from './ui-collection-targets.js';
import { liveSystemContext, saveSystemEditor } from './ui-system-context.js';
import { Popup } from '../../../../../../popup.js';
import { escapeHtml, moveInList } from '../../core/utils.js';
import { isNumericStat } from '../../tracker/status-logic.js';
import { statPolicyMarkup, bindStatPolicy } from './ui-system-stat-policy.js';

export function parseOptions(text) {
    return String(text || '').split(',').map(v => v.trim()).filter(Boolean);
}
/** The Format a field has when its label is the field's own name. */
const NAMED_FORMAT = '{{name}}: {{value}}';
/** The Format a field has when it shows the value alone. */
const BARE_FORMAT = '{{value}}';

export function buildStatsEditor(settingsKey, onRefresh, context = liveSystemContext) {
    const { renameStat, updateHUD } = context;
    const saveSettings = () => saveSystemEditor(context);
    const wrap = document.createElement('div');
    const definition = context.definition();
    const stats = definition?.stats[settingsKey === 'globalStats' ? 'world' : 'character'];
    if (!stats) { wrap.textContent = 'Select a System to edit its stats.'; return wrap; }

    stats.forEach((stat, index) => {
        const pool = isPoolStat(stat);
        const row = document.createElement('div');
        row.className = 'sillynpc-alias-row sillynpc-system-stat-row';
        row.innerHTML = `
            <div class="sillynpc-stat-header">
                <input type="text" class="text_pole stat-name" value="${escapeHtml(stat.name)}" placeholder="Stat Name" style="flex:1">
                <input type="text" class="text_pole stat-default" value="${escapeHtml(stat.defaultValue || '')}" placeholder="Default Value" style="flex:1">
                <button type="button" class="menu_button stat-up-btn" title="Move up - this order is the order the tracker, the character page and the reader all use" ${index === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                <button type="button" class="menu_button stat-down-btn" title="Move down" ${index === stats.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
                <button type="button" class="menu_button delete-btn"><i class="fa-solid fa-trash"></i></button>
            </div>
            <div class="sillynpc-stat-definition">
                <small class="sillynpc-field-note">Purpose:</small>
                <input type="text" class="text_pole stat-purpose" value="${escapeHtml(stat.purpose || '')}"
                       placeholder="What this stat measures and when it changes"
                       title="Sent to the reader for every stat type and to the Narrator when this stat appears in the scene context. Explain what this stat means and which story events change it."
                       style="flex:1; min-width:180px;">
                ${isNumericStat(stat) ? `
                <small class="sillynpc-field-note">Min:</small>
                <input type="text" class="text_pole stat-min" value="${escapeHtml(stat.min ?? '')}" placeholder="0" title="Lowest current value. The tracker enforces this bound; use a negative number for ranges like -100..100." style="width:45px;">
                <small class="sillynpc-field-note" title="${!pool
                    ? 'Fixed upper bound for this rating. Level growth cannot raise it.'
                    : 'Hard ceiling for pool capacity growth. Leave blank to allow capacity growth.'}">${!pool ? 'Max:' : 'Limit:'}</small>
                <input type="text" class="text_pole stat-max" value="${escapeHtml(stat.maxStatValue || '')}" placeholder="Max" title="${!pool
                    ? 'Fixed upper bound. A rating such as 1 to 5 stays within this range.'
                    : 'Optional hard capacity limit. Set the starting pool in Default, for example 6/10. Leave this limit blank for expandable capacity.'}" style="width:50px;">
                ` : `
                <small class="sillynpc-field-note">Write it:</small>
                <input type="text" class="text_pole stat-hint" value="${escapeHtml(stat.guidance || stat.hint || '')}"
                       placeholder="e.g. the current objective only, one line"
                       title="Told to the reader when it fills this field in. Say the shape you want - a date as DD.MM.YY, a single sentence, a place name - and it is sent with every extraction."
                       style="flex:1; min-width:120px;">
                <small class="sillynpc-field-note" title="A hard limit the extension applies itself, so a field cannot grow into a log however the reader answers. Blank means no limit.">Max chars:</small>
                <input type="text" class="text_pole stat-length" value="${escapeHtml(stat.maxLength ?? '')}"
                       placeholder="—" title="Blank for no limit. Anything longer is cut back to a word boundary and marked."
                       style="width:50px;">
                `}
                <select class="text_pole stat-type" title="What this stat holds. A Number is a quantity, so it can have a minimum and a maximum; write its value as 53/53 to get a meter, or as 53 for a plain number. Text is anything else." style="width:80px;">
                    <option value="text" ${!isNumericStat(stat) ? 'selected' : ''}>Text</option>
                    <option value="number" ${isNumericStat(stat) ? 'selected' : ''}>Number</option>
                </select>
                ${!isNumericStat(stat) ? `<input type="text" class="text_pole stat-options"
                       value="${escapeHtml((stat.options || []).join(', '))}"
                       placeholder="Any value"
                       title="Allowed values, separated by commas. Leave empty to allow anything."
                       style="flex:1.2; min-width:120px;">` : ''}
            </div>
            <div class="sillynpc-stat-options">
                ${statPolicyMarkup(stat, settingsKey, escapeHtml)}
                ${settingsKey === 'characterStats' ? `
                <label class="sillynpc-check-group"
                       title="Draw this on the floating HUD, as a meter with its name and value.">
                    <input type="checkbox" class="stat-primary" ${stat.isPrimary ? 'checked' : ''}>
                    <small>Player HUD</small>
                </label>
                <label class="sillynpc-check-group"
                       title="Show this in the tracker box in the chat, with your other fields and before your collections.">
                    <input type="checkbox" class="stat-visible" ${stat.visible !== false ? 'checked' : ''}>
                    <small>Tracker</small>
                </label>
                ` : `
                <label class="sillynpc-check-group"
                       title="Show this in the tracker box in the chat.">
                    <input type="checkbox" class="stat-visible" ${stat.visible !== false ? 'checked' : ''}>
                    <small>Visible</small>
                </label>
                `}
                <label class="sillynpc-check-group"
                       title="Show the field name in front of the value on the tracker.">
                    <input type="checkbox" class="stat-show-name"
                           ${String(stat.format || '').includes('{{name}}') ? 'checked' : ''}>
                    <small>Show name</small>
                </label>
                <label class="sillynpc-check-group"
                       title="Prevent story reader changes after initialization. Level-up increases and direct edits remain available.">
                    <input type="checkbox" class="stat-locked" ${stat.locked ? 'checked' : ''}>
                    <small>Locked</small>
                </label>
                ${settingsKey === 'characterStats' ? `
                <label class="sillynpc-check-group" title="Colour of this stat's meter on the floating HUD">
                    <input type="color" class="stat-color" value="${stat.color || '#7aa2f7'}" style="width:26px; height:20px; padding:0; border:0; background:none; cursor:pointer;">
                    <small>Meter</small>
                </label>
                ` : ''}
            </div>
        `;
        
        const statNameInput = row.querySelector('.stat-name');
        statNameInput.title = 'Renaming this carries its stored values and the display template.';
        statNameInput.addEventListener('change', (e) => {
            const oldName = stat.name;
            const newName = e.target.value.trim();
            if (!newName || newName === oldName) {
                e.target.value = oldName;
                return;
            }
            if (fieldAssignmentConflicts(stats, stat, { name: newName }).length) {
                toastr.error(`These actors already have a stat called "${newName}".`, 'SillyNPC');
                e.target.value = oldName;
                return;
            }

            stat.name = newName;
            const targets = fieldTargets(stat);
            const scopes = settingsKey === 'characterStats'
                ? [targets.includes('player') && 'playerStats', targets.some(target => target === 'npc' || target.startsWith('template:')) && 'npcStats'].filter(Boolean)
                : [settingsKey];
            const carried = scopes.map(scope => renameStat(scope, oldName, newName, stat)).reduce((sum, result) => ({
                values: sum.values + (result.values || 0), templateUpdated: sum.templateUpdated || result.templateUpdated, cssMentions: sum.cssMentions || result.cssMentions,
            }), { values: 0 });
            saveSettings();

            const parts = [];
            if (carried.values) parts.push(`${carried.values} stored value${carried.values === 1 ? '' : 's'}`);
            if (carried.templateUpdated) parts.push('the display template');
            if (parts.length) {
                toastr.success(`Renamed to "${newName}" and carried ${parts.join(', ')} across.`, 'SillyNPC');
            }

            if (carried.cssMentions) {
                toastr.warning(`Your custom CSS still mentions "${oldName}". Check it by hand.`, 'SillyNPC');
            }
            onRefresh();
        });
        row.querySelector('.stat-color')?.addEventListener('input', (e) => {
            stat.color = e.target.value;
            saveSettings();
            updateHUD();
        });
        row.querySelector('.stat-default').addEventListener('change', (e) => { stat.defaultValue = e.target.value; saveSettings(); onRefresh(); });
        row.querySelector('.stat-purpose').addEventListener('input', (e) => { stat.purpose = e.target.value; saveSettings(); });
        row.querySelector('.stat-max')?.addEventListener('input', (e) => { stat.maxStatValue = e.target.value; saveSettings(); });
        row.querySelector('.stat-min')?.addEventListener('input', (e) => { stat.min = e.target.value; saveSettings(); updateHUD(); });
        attachRangeValidation(row, row.querySelector('.stat-min'), row.querySelector('.stat-max'));
        row.querySelector('.stat-hint')?.addEventListener('input', (e) => { stat.guidance = stat.hint = e.target.value; saveSettings(); });
        row.querySelector('.stat-length')?.addEventListener('input', (e) => {

            stat.maxLength = e.target.value.trim();
            saveSettings();
        });
        for (const [selector, delta] of [['.stat-up-btn', -1], ['.stat-down-btn', 1]]) {
            row.querySelector(selector)?.addEventListener('click', () => {
                if (!moveInList(stats, index, delta)) return;
                saveSettings();
                updateHUD();
                onRefresh();
            });
        }
        row.querySelector('.stat-type').addEventListener('change', (e) => {
            stat.type = e.target.value;
            if (stat.type === 'number') stat.options = [];
            saveSettings();
            updateHUD();
            onRefresh();
        });
        row.querySelector('.stat-visible').addEventListener('change', (e) => { stat.visible = e.target.checked; saveSettings(); onRefresh(); });
        bindStatPolicy(row, stat, saveSettings, onRefresh);
        row.querySelector('.stat-locked').addEventListener('change', (e) => { stat.locked = e.target.checked; saveSettings(); onRefresh(); });
        row.querySelector('.stat-show-name').addEventListener('change', (e) => {
            stat.format = e.target.checked ? NAMED_FORMAT : BARE_FORMAT;
            saveSettings();
            onRefresh();
        });
        row.querySelector('.stat-options')?.addEventListener('change', (e) => {
            stat.options = parseOptions(e.target.value);
            saveSettings();
            onRefresh();
        });
        if (settingsKey === 'characterStats') {
            row.querySelector('.stat-primary').addEventListener('change', (e) => {
                stat.isPrimary = e.target.checked;
                saveSettings();
                updateHUD();
                onRefresh();
            });
        }
        row.querySelector('.delete-btn').addEventListener('click', async () => {
            const ok = await Popup.show.confirm(
                `Delete "${stat.name || 'this field'}"?`,
                'The field is removed from the tracker. Values already recorded on a '
                + 'character are left alone but will no longer be shown.',
            );
            if (!ok) return;
            stats.splice(index, 1);
            saveSettings();
            onRefresh();
        });

        if (settingsKey === 'characterStats') row.appendChild(buildTargetsEditor(stat, () => {
            if (fieldAssignmentConflicts(stats, stat).length) {
                toastr.error(`These actors already have a stat called "${stat.name}". Rename it or choose other targets.`, 'SillyNPC');
                return false;
            }
            saveSettings(); updateHUD(); onRefresh();
        }, definition.npcTemplates));
        wrap.appendChild(row);
    });
    
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'menu_button';
    addBtn.innerHTML = `<i class="fa-solid fa-plus"></i> Add New Field`;
    addBtn.addEventListener('click', () => {
        let name = 'New Stat';
        for (let suffix = 2; stats.some(stat => stat.name === name); suffix++) name = `New Stat ${suffix}`;
        const newStat = { name, defaultValue: '', format: '{{value}}', visible: true,
            type: 'text', min: '', locked: false, carryOver: false };
        if (settingsKey === 'characterStats') newStat.advanceOnLevel = false;
        newStat.maxStatValue = '';
        stats.push(newStat);
        if (settingsKey === 'characterStats') newStat.targets = ['player', 'npc'];
        const normalized = normalizeSystemDefinition(definition);
        newStat.id = normalized.stats[settingsKey === 'globalStats' ? 'world' : 'character'].at(-1).id;
        saveSettings();
        onRefresh();
    });
    
    wrap.appendChild(addBtn);
    return wrap;
}
