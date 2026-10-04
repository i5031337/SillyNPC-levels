import { attachRangeValidation } from './ui-system-range.js';
import { ensureNpcStatIds } from './ui-npc-templates.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { Popup } from '../../../../../../popup.js';
import { updateHUD } from '../hud/ui-hud.js';
import { escapeHtml, moveInList } from '../../core/utils.js';
import { buildBulkBar, buildBulkCheckbox, spliceIndexes } from '../shared/ui-bulk-select.js';
import { renameStat, isNumericStat } from '../../tracker/status-logic.js';
import { statPolicyMarkup, bindStatPolicy } from './ui-system-stat-policy.js';

export function parseOptions(text) {
    return String(text || '').split(',').map(v => v.trim()).filter(Boolean);
}
/** The Format a field has when its label is the field's own name. */
const NAMED_FORMAT = '{{name}}: {{value}}';
/** The Format a field has when it shows the value alone. */
const BARE_FORMAT = '{{value}}';

/**
 * Whether the Name checkbox can speak for this Format at all.
 *
 * A field whose Format writes its own wording - `DD: {{value}}` - is not one of the two
 * states the checkbox toggles between, and ticking it would have to throw that wording
 * away. A checkbox that quietly deletes something you typed is worse than one you
 * cannot press.
 */
function formatIsToggleable(format) {
    const text = String(format ?? '').trim();
    if (!text || text === BARE_FORMAT) return true;
    return text.includes('{{name}}');
}
/**
 * One bulk-select handle per stat list, kept across the redraws ticking a box causes.
 *
 * Keyed by the settings key rather than shared, or ticking a global stat would carry its
 * index onto the NPC list - and index 2 exists in both.
 *
 * @type {Map<string, object>}
 */
const statBulkBars = new Map();

export function statsBulkBar(settingsKey, onRefresh, noun = 'field') {
    if (!statBulkBars.has(settingsKey)) {
        statBulkBars.set(settingsKey, buildBulkBar({
            noun,
            allIds: () => (getSettings().statusTracker[settingsKey] || []).map((_, i) => i),
            onDelete: (ids) => {
                // Descending, or the first splice shifts every index chosen after it.
                spliceIndexes(getSettings().statusTracker[settingsKey], ids);
                saveSettings();
            },
            onRefresh: () => onRefresh(),
        }));
    }
    return statBulkBars.get(settingsKey);
}

export function buildStatsEditor(label, settingsKey, onRefresh) {
    const wrap = document.createElement('div');
    const stats = getSettings().statusTracker[settingsKey];
    const bulk = statsBulkBar(settingsKey, onRefresh);
    wrap.appendChild(bulk.bar);

    stats.forEach((stat, index) => {
        const advancement = stat.updatePolicy === 'advancement'
            || (!stat.updatePolicy && stat.persistence === 'innate');
        const row = document.createElement('div');
        row.className = 'sillynpc-alias-row';
        row.style.marginBottom = '12px';
        row.style.flexWrap = 'wrap';
        row.innerHTML = `
            <div style="display:flex; gap:8px; width:100%; margin-bottom:4px;">
                <input type="text" class="text_pole stat-name" value="${escapeHtml(stat.name)}" placeholder="Stat Name" style="flex:1">
                <input type="text" class="text_pole stat-default" value="${escapeHtml(stat.defaultValue || '')}" placeholder="Default Value" style="flex:1">
                <button type="button" class="menu_button stat-up-btn" title="Move up - this order is the order the tracker, the character page and the reader all use" ${index === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                <button type="button" class="menu_button stat-down-btn" title="Move down" ${index === stats.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
                <button type="button" class="menu_button delete-btn"><i class="fa-solid fa-trash"></i></button>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:8px; width:100%; align-items:center;">
                <small class="sillynpc-field-note">Purpose:</small>
                <input type="text" class="text_pole stat-purpose" value="${escapeHtml(stat.purpose || '')}"
                       placeholder="What this stat measures and when it changes"
                       title="Sent to the reader for every stat type. Explain what this stat means and which story events change it."
                       style="flex:1; min-width:180px; font-size:var(--sillynpc-text-md); height:24px;">
                <small class="sillynpc-field-note">Format:</small>
                <input type="text" class="text_pole stat-format" value="${escapeHtml(stat.format || '{{value}}')}" placeholder="e.g. HP: {{value}}" style="flex:1; font-size:var(--sillynpc-text-md); height:24px;">
                ${isNumericStat(stat) ? `
                <small class="sillynpc-field-note">Min:</small>
                <input type="text" class="text_pole stat-min" value="${escapeHtml(stat.min ?? '')}" placeholder="0" title="Lowest current value. The tracker enforces this bound; use a negative number for ranges like -100..100." style="width:45px; font-size:var(--sillynpc-text-md); height:24px;">
                <small class="sillynpc-field-note" title="${advancement
                    ? 'Fixed upper bound for this Advancement rating. Level bonuses cannot raise it.'
                    : 'Initial maximum for a Turn pool. Each actor then carries its own maximum, which only a level-up bonus can raise.'}">${advancement ? 'Max:' : 'Starts max:'}</small>
                <input type="text" class="text_pole stat-max" value="${escapeHtml(stat.maxStatValue || '')}" placeholder="Max" title="${advancement
                    ? 'Fixed upper bound. A rating such as 1 to 5 stays within this range.'
                    : 'Starting maximum for a new Turn pool. Ordinary story updates keep each actor’s maximum fixed.'}" style="width:50px; font-size:var(--sillynpc-text-md); height:24px;">
                ` : `
                <small class="sillynpc-field-note">Write it:</small>
                <input type="text" class="text_pole stat-hint" value="${escapeHtml(stat.hint || '')}"
                       placeholder="e.g. the current objective only, one line"
                       title="Told to the reader when it fills this field in. Say the shape you want - a date as DD.MM.YY, a single sentence, a place name - and it is sent with every extraction."
                       style="flex:1; min-width:120px; font-size:var(--sillynpc-text-md); height:24px;">
                <small class="sillynpc-field-note" title="A hard limit the extension applies itself, so a field cannot grow into a log however the reader answers. Blank means no limit.">Max chars:</small>
                <input type="text" class="text_pole stat-length" value="${escapeHtml(stat.maxLength ?? '')}"
                       placeholder="—" title="Blank for no limit. Anything longer is cut back to a word boundary and marked."
                       style="width:50px; font-size:var(--sillynpc-text-md); height:24px;">
                `}
                <select class="text_pole stat-type" title="What this stat holds. A Number is a quantity, so it can have a minimum, a maximum and time rules; write its value as 53/53 to get a meter, or as 53 for a plain number. Text is anything else." style="width:80px; font-size:var(--sillynpc-text-md); height:24px;">
                    <option value="text" ${!isNumericStat(stat) ? 'selected' : ''}>Text</option>
                    <option value="number" ${isNumericStat(stat) ? 'selected' : ''}>Number</option>
                </select>
                ${statPolicyMarkup(stat, settingsKey, isNumericStat(stat), escapeHtml)}
                ${settingsKey === 'playerStats' ? `
                <label class="sillynpc-check-group" style="margin-left:10px;"
                       title="Draw this on the floating HUD, as a meter with its name and value.">
                    <input type="checkbox" class="stat-primary" ${stat.isPrimary ? 'checked' : ''}>
                    <small>HUD</small>
                </label>
                <label class="sillynpc-check-group" style="margin-left:6px;"
                       title="Show this in the tracker box in the chat, with your other fields and before your collections.">
                    <input type="checkbox" class="stat-visible" ${stat.visible !== false ? 'checked' : ''}>
                    <small>Tracker</small>
                </label>
                ` : `
                <label class="sillynpc-check-group" style="margin-left:10px;"
                       title="Show this in the tracker box in the chat.">
                    <input type="checkbox" class="stat-visible" ${stat.visible !== false ? 'checked' : ''}>
                    <small>Visible</small>
                </label>
                `}
                <label class="sillynpc-check-group" style="margin-left:6px;"
                       title="${formatIsToggleable(stat.format)
                            ? 'Show the field name in front of the value on the tracker.'
                            : 'This field\'s Format already sets its own label.'}">
                    <input type="checkbox" class="stat-show-name"
                           ${String(stat.format || '').includes('{{name}}') ? 'checked' : ''}
                           ${formatIsToggleable(stat.format) ? '' : 'disabled'}>
                    <small>Name</small>
                </label>
                <label class="sillynpc-check-group" style="margin-left:6px;"
                       title="Immutable during play. The tracker may initialize a blank NPC field once, then ignores later story changes. Direct edits remain available to correct mistakes.">
                    <input type="checkbox" class="stat-locked" ${stat.locked ? 'checked' : ''}>
                    <small>Locked</small>
                </label>
                ${!isNumericStat(stat) ? `<input type="text" class="text_pole stat-options"
                       value="${escapeHtml((stat.options || []).join(', '))}"
                       placeholder="Any value"
                       title="Allowed values, separated by commas. Leave empty to allow anything."
                       style="flex:1.2; min-width:120px; font-size:var(--sillynpc-text-md); height:24px; margin-left:10px;">` : ''}
                ${settingsKey === 'playerStats' ? `
                <label class="sillynpc-check-group" style="margin-left:6px;" title="Colour of this stat's meter on the floating HUD">
                    <input type="color" class="stat-color" value="${stat.color || '#7aa2f7'}" style="width:26px; height:20px; padding:0; border:0; background:none; cursor:pointer;">
                    <small>Meter</small>
                </label>
                ` : ''}
            </div>
        `;
        
        const statNameInput = row.querySelector('.stat-name');
        statNameInput.title = 'Renaming this carries its stored values, the scene binding, '
            + 'any time rule that names it, and the display template.';
        // Committed when you leave the box rather than on every keystroke: renaming per
        // letter would migrate every stored value once per character typed, and an emptied
        // box would briefly name the stat "".
        statNameInput.addEventListener('change', (e) => {
            const oldName = stat.name;
            const newName = e.target.value.trim();
            if (!newName || newName === oldName) {
                e.target.value = oldName;
                return;
            }
            if (stats.some(s => s !== stat && s.name === newName)) {
                toastr.error(`This list already has a stat called "${newName}".`, 'SillyNPC');
                e.target.value = oldName;
                return;
            }

            if (settingsKey === 'npcStats') ensureNpcStatIds();
            stat.name = newName;
            const carried = renameStat(settingsKey, oldName, newName);
            saveSettings();

            const parts = [];
            if (carried.values) parts.push(`${carried.values} stored value${carried.values === 1 ? '' : 's'}`);
            if (carried.references) parts.push(`${carried.references} reference${carried.references === 1 ? '' : 's'}`);
            if (carried.templateUpdated) parts.push('the display template');
            if (parts.length) {
                toastr.success(`Renamed to "${newName}" and carried ${parts.join(', ')} across.`, 'SillyNPC');
            }
            // Not rewritten, because a selector can be built from a name in more ways than
            // can be recognised - but silence here would look like nothing was left behind.
            if (carried.cssMentions) {
                toastr.warning(`Your custom CSS still mentions "${oldName}". Check it by hand.`, 'SillyNPC');
            }
            onRefresh();
        });
        // The meter used to take its colour from a stylesheet rule keyed to the stat's
        // name, so only HP, MP, Mana and Energy ever had one.
        row.querySelector('.stat-color')?.addEventListener('input', (e) => {
            stat.color = e.target.value;
            saveSettings();
            updateHUD();
        });
        row.querySelector('.stat-default').addEventListener('input', (e) => { stat.defaultValue = e.target.value; saveSettings(); });
        row.querySelector('.stat-format').addEventListener('input', (e) => { stat.format = e.target.value; saveSettings(); });
        row.querySelector('.stat-purpose').addEventListener('input', (e) => { stat.purpose = e.target.value; saveSettings(); });
        // Optional chaining because the row only carries the controls its type uses:
        // Min and Starts max belong to a Meter, the hint and the cap to a Text field.
        // They were all shown on every row, which is why a Text field offered a lower
        // bound it has no use for - and where the room for the new pair came from.
        row.querySelector('.stat-max')?.addEventListener('input', (e) => { stat.maxStatValue = e.target.value; saveSettings(); });
        // The lower bound is where a meter starts filling from, so the HUD is showing it.
        row.querySelector('.stat-min')?.addEventListener('input', (e) => { stat.min = e.target.value; saveSettings(); updateHUD(); });
        attachRangeValidation(row, row.querySelector('.stat-min'), row.querySelector('.stat-max'));
        row.querySelector('.stat-hint')?.addEventListener('input', (e) => { stat.hint = e.target.value; saveSettings(); });
        row.querySelector('.stat-length')?.addEventListener('input', (e) => {
            // Kept as typed rather than coerced: a half-typed number must not become 0,
            // which would read as a limit of nothing. capToLength ignores anything that
            // is not a positive number.
            stat.maxLength = e.target.value.trim();
            saveSettings();
        });
        for (const [selector, delta] of [['.stat-up-btn', -1], ['.stat-down-btn', 1]]) {
            row.querySelector(selector)?.addEventListener('click', () => {
                if (!moveInList(stats, index, delta)) return;
                saveSettings();
                // The HUD draws its meters in this order too, and it is a separate element from
                // this panel - without this it kept the old order until something else redrew it.
                updateHUD();
                // The whole editor, not the row: the buttons at both ends have to become
                // enabled or disabled as entries pass them.
                onRefresh();
            });
        }

        /* updateHUD as well as onRefresh, which redraws this panel and nothing else. The HUD
           is a separate element, so switching a field from Number back to Text left it still
           drawing a meter until something else happened to redraw it - and that looked
           exactly like the type not taking effect. The colour, order and HUD handlers above
           and below already say the same thing. */
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
        // A shortcut for writing Format, not a second mechanism: one place decides what
        // a field is labelled, and it is the box right there in the row.
        row.querySelector('.stat-show-name').addEventListener('change', (e) => {
            stat.format = e.target.checked ? NAMED_FORMAT : BARE_FORMAT;
            saveSettings();
            onRefresh();
        });
        // Committed on change rather than per keystroke: a half-typed list would refuse
        // values the user is in the middle of allowing.
        row.querySelector('.stat-options')?.addEventListener('change', (e) => {
            stat.options = parseOptions(e.target.value);
            saveSettings();
            onRefresh();
        });
        if (settingsKey === 'playerStats') {
            row.querySelector('.stat-primary').addEventListener('change', (e) => {
                stat.isPrimary = e.target.checked;
                saveSettings();
                // The HUD is a separate element from this panel; without this the meter
                // only appeared after a reload, or after some other setting refreshed it.
                updateHUD();
                onRefresh();
            });
        }
        row.querySelector('.delete-btn').addEventListener('click', async () => {
            // It used to go on one click with nothing asked. Bulk delete asks, and two
            // doors onto the same act should not disagree about how final it is.
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

        if (bulk.isActive()) {
            // The checkbox replaces the row's own delete while selecting.
            row.querySelector('.delete-btn')?.replaceWith(buildBulkCheckbox(bulk, index));
        }

        wrap.appendChild(row);
    });
    
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'menu_button';
    addBtn.innerHTML = `<i class="fa-solid fa-plus"></i> Add New Field`;
    addBtn.addEventListener('click', () => {
        const newStat = { name: 'New Stat', defaultValue: '', format: '{{value}}', visible: true,
            type: 'text', min: '', updatePolicy: 'turn' };
        if (settingsKey === 'playerStats') newStat.advanceOnLevel = false;
        newStat.maxStatValue = '';
        stats.push(newStat);
        if (settingsKey === 'npcStats') ensureNpcStatIds();
        saveSettings();
        onRefresh();
    });
    
    wrap.appendChild(addBtn);
    return wrap;
}
