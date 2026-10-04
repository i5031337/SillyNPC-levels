import { attachRangeValidation } from './ui-system-range.js';
import { ensureCollectionIdentifier, moveCollectionField, deleteCollectionField } from '../../core/collection-fields.js';
import { saveSettings } from '../../core/settings.js';
import { escapeHtml } from '../../core/utils.js';
import { renameCollectionField } from '../../tracker/status-logic.js';
import { parseOptions } from './ui-system-stats.js';

/** Render and wire one collection's field rows. Rebuild after structural edits. */
export function renderCollectionFields(col, fieldsList, onRefresh) {
    if (ensureCollectionIdentifier(col)) saveSettings();
    fieldsList.replaceChildren();
    col.fields.forEach((field, index) => {
        const box = createFieldBox();
        const row = createFieldControls(col, field, index);
        wireFieldControls(row, col, field, index, fieldsList, onRefresh);
        box.append(row, createFieldHint(field));
        fieldsList.appendChild(box);
    });
}

function createFieldBox() {
    const box = document.createElement('div');
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.gap = '3px';
    box.style.marginBottom = '8px';
    return box;
}

function createFieldControls(col, field, fIdx) {
    const fRow = document.createElement('div');
    fRow.className = 'sillynpc-collection-field-row';
    fRow.style.display = 'flex';
    fRow.style.flexWrap = 'wrap';
    fRow.style.gap = '5px';
    fRow.style.alignItems = 'center';
    fRow.innerHTML = `
        <input type="text" class="text_pole f-name" value="${escapeHtml(field.name)}" placeholder="Key" style="width:60px; font-size:var(--sillynpc-text-sm);" title="Field key (e.g. weight)">
        <input type="text" class="text_pole f-label" value="${escapeHtml(field.label || '')}" placeholder="Label" style="flex:1; font-size:var(--sillynpc-text-sm);" title="Display Label">
        <input type="text" class="text_pole f-default" value="${escapeHtml(field.defaultValue !== undefined ? field.defaultValue : '')}" placeholder="Def" style="width:40px; font-size:var(--sillynpc-text-sm);" title="Default Value">
        <select class="text_pole f-type" style="width:65px; font-size:var(--sillynpc-text-sm);">
            <option value="text" ${field.type === 'text' ? 'selected' : ''}>Text</option>
            <option value="number" ${field.type === 'number' ? 'selected' : ''}>Num</option>
            <option value="boolean" ${field.type === 'boolean' ? 'selected' : ''}>Bool</option>
        </select>
        ${fIdx === 0 ? '<small class="sillynpc-collection-identifier" title="The first field always identifies each entry and cannot be moved or deleted.">Identifier</small>' : ''}
        ${field.type === 'text' ? `
        <label class="sillynpc-check-group-tight" title="Edit this field in a box you can write several lines in, rather than on one line. Text fields only.&#10;&#10;Ticked together with Static, it also means the field is prose belonging to the item rather than to whoever is holding it - see Static.">
            <input type="checkbox" class="f-multiline" ${field.isMultiline ? 'checked' : ''}>
            <small class="sillynpc-row-hint">Multi</small>
        </label>
        ` : ''}
        ${field.type !== 'number' || field.isPrimary ? `
        <label class="sillynpc-check-group-tight" title="This field belongs to the item, not to whoever is holding it. Its value is kept once in the Item Library and copied onto every copy of that item, so the same thing reads the same way on everybody.&#10;&#10;The tracker's reader is shown the value every message - it has to know what a thing is to judge what a message did with it - but it cannot change one: the Library's value is written back over whatever it returns. Untick this to have the reader keep the field up to date per holder instead.&#10;&#10;Numbers ignore this and are always per-holder, unless the number is the identifier.">
            <input type="checkbox" class="f-static" ${field.isStatic !== false ? 'checked' : ''}>
            <small class="sillynpc-row-hint">Static</small>
        </label>
        ` : ''}
        ${field.type === 'number' ? `
            <label class="sillynpc-collection-bound"><small class="sillynpc-field-note">Min:</small>
            <input type="number" step="any" class="text_pole f-min" value="${escapeHtml(field.min ?? '')}"
                   placeholder="Min" title="Optional minimum value. Leave blank for no lower bound."
                   style="width:55px; font-size:var(--sillynpc-text-sm);"></label>
            <label class="sillynpc-collection-bound"><small class="sillynpc-field-note">Max:</small>
            <input type="number" step="any" class="text_pole f-max" value="${escapeHtml(field.maxStatValue ?? '')}"
                   placeholder="Max" title="Optional maximum value. Leave blank for no upper bound."
                   style="width:55px; font-size:var(--sillynpc-text-sm);"></label>
        ` : `<input type="text" class="text_pole f-options"
               value="${escapeHtml((field.options || []).join(', '))}"
               placeholder="Any value"
               title="Allowed values, separated by commas. Leave empty to allow anything."
               style="width:110px; font-size:var(--sillynpc-text-sm);">`}
        ${fIdx === 0 ? '' : `
        <span class="sillynpc-collection-field-actions">
        <button type="button" class="menu_button move-field-up" title="Move up" style="padding:0 5px;" ${fIdx === 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
        <button type="button" class="menu_button move-field-down" title="Move down" style="padding:0 5px;" ${fIdx === col.fields.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
        <button type="button" class="menu_button delete-field-btn" style="padding:0 5px; color:var(--red);"><i class="fa-solid fa-xmark"></i></button></span>`}

    `;
    return fRow;
}

function wireFieldControls(fRow, col, field, fIdx, fieldsList, onRefresh) {
    wireFieldRename(fRow, col, field, onRefresh);
    wireFieldProperties(fRow, col, field, fieldsList, onRefresh);
    wireFieldStructure(fRow, col, fIdx, fieldsList, onRefresh);
    attachRangeValidation(fRow, fRow.querySelector('.f-min'), fRow.querySelector('.f-max'));
}

function wireFieldRename(fRow, col, field, onRefresh) {
    const nameInput = fRow.querySelector('.f-name');
    nameInput.title = 'Field key. Renaming it carries the stored values across.';
    // Sanitised as you type, committed when you leave the box. Renaming on
    // every keystroke would migrate the whole library once per letter, and an
    // emptied box would briefly name the field ''.
    nameInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    });
    nameInput.addEventListener('change', (e) => {
        const oldName = field.name;
        const newName = e.target.value.trim();
        if (!newName || newName === oldName) {
            e.target.value = oldName;
            return;
        }
        if (col.fields.some(f => f !== field && f.name === newName)) {
            toastr.error(`This collection already has a field called "${newName}".`, 'SillyNPC');
            e.target.value = oldName;
            return;
        }
        field.name = newName;
        const moved = renameCollectionField(col.id, oldName, newName);
        saveSettings();
        // A rename that moved nothing and one that moved forty items look the
        // same afterwards, and the difference is worth knowing.
        if (moved) {
            toastr.success(`Renamed to "${newName}" and carried ${moved} item${moved === 1 ? '' : 's'} across.`, 'SillyNPC');
        }
        onRefresh();
    });
}

function wireFieldProperties(fRow, col, field, fieldsList, onRefresh) {
    fRow.querySelector('.f-label').addEventListener('input', (e) => { field.label = e.target.value; saveSettings(); });
    fRow.querySelector('.f-default').addEventListener('input', (e) => { field.defaultValue = e.target.value; saveSettings(); });
    fRow.querySelector('.f-options')?.addEventListener('change', (e) => {
        field.options = parseOptions(e.target.value);
        saveSettings();
        renderCollectionFields(col, fieldsList, onRefresh);
    });
    fRow.querySelector('.f-min')?.addEventListener('input', (e) => { field.min = e.target.value; saveSettings(); });
    fRow.querySelector('.f-max')?.addEventListener('input', (e) => { field.maxStatValue = e.target.value; saveSettings(); });
    fRow.querySelector('.f-type').addEventListener('change', (e) => {
        field.type = e.target.value;
        if (field.type === 'number') delete field.options;
        if (field.type !== 'text') field.isMultiline = false;

        // Default isStatic logic: numbers are dynamic by default, others static
        field.isStatic = field.type !== 'number';

        saveSettings();
        renderCollectionFields(col, fieldsList, onRefresh);
    });
    fRow.querySelector('.f-multiline')?.addEventListener('change', (e) => { field.isMultiline = e.target.checked; saveSettings(); });
    fRow.querySelector('.f-static')?.addEventListener('change', (e) => { field.isStatic = e.target.checked; saveSettings(); });
}

function wireFieldStructure(fRow, col, fIdx, fieldsList, onRefresh) {
    for (const [selector, delta] of [['.move-field-up', -1], ['.move-field-down', 1]]) {
        fRow.querySelector(selector)?.addEventListener('click', () => {
            if (!moveCollectionField(col, fIdx, delta)) return;
            saveSettings();
            renderCollectionFields(col, fieldsList, onRefresh);
        });
    }

    fRow.querySelector('.delete-field-btn')?.addEventListener('click', () => {
        if (!deleteCollectionField(col, fIdx)) return;
        saveSettings();
        renderCollectionFields(col, fieldsList, onRefresh);
    });
}

function createFieldHint(field) {
    const hint = document.createElement('input');
    hint.type = 'text';
    hint.className = 'text_pole f-hint';
    hint.value = field.hint || '';
    hint.placeholder = `What "${field.label || field.name}" is for - sent to the tracker's reader`;
    hint.title = `What this field means. Sent to the tracker's reader with the field list, `
        + 'so a number called Cost can say what it costs. Leave empty to send only the name and type.';
    hint.style.fontSize = 'var(--sillynpc-text-sm)';
    hint.style.opacity = '0.9';
    hint.addEventListener('input', (e) => { field.hint = e.target.value; saveSettings(); });
    return hint;
}
