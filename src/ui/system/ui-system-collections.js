import { buildCollectionTargetsEditor } from './ui-collection-targets.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { Popup } from '../../../../../../popup.js';
import { escapeHtml, moveInList } from '../../core/utils.js';
import { buildBulkCheckbox } from '../shared/ui-bulk-select.js';
import { renameCollectionId } from '../../tracker/status-logic.js';
import { statsBulkBar } from './ui-system-stats.js';
import { renderCollectionFields } from './ui-collection-fields.js';

export function buildCollectionsEditor(onRefresh) {
    const wrap = document.createElement('div');
    const settings = getSettings().statusTracker;
    const collections = settings.collections || [];

    // Migration logic: convert string fields to object fields
    collections.forEach(col => {
        if (Array.isArray(col.fields) && col.fields.length > 0 && typeof col.fields[0] === 'string') {
            col.fields = col.fields.map(fieldName => ({
                name: fieldName,
                type: fieldName === 'quantity' ? 'number' : 'text',
                label: fieldName.charAt(0).toUpperCase() + fieldName.slice(1),
                isMultiline: fieldName === 'description',
                isPrimary: fieldName === 'name',
                defaultValue: fieldName === 'quantity' ? '1' : ''
            }));
            saveSettings();
        }
    });

    const bulk = statsBulkBar('collections', onRefresh, 'collection');
    wrap.appendChild(bulk.bar);

    collections.forEach((col, index) => wrap.appendChild(createCollectionRow(col, index, collections, bulk, onRefresh)));

    const addBtn = document.createElement('button');
    addBtn.className = 'menu_button';
    addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add Collection';
    addBtn.addEventListener('click', () => {
        collections.push({
            id: 'new_collection',
            name: 'New Collection',
            fields: [
                { name: 'name', label: 'Name', type: 'text', isPrimary: true, isStatic: true, defaultValue: '' },
                { name: 'quantity', label: 'Quantity', type: 'number', isPrimary: false, isStatic: false, defaultValue: '1' },
                { name: 'description', label: 'Description', type: 'text', isMultiline: true, isPrimary: false, isStatic: true, defaultValue: '' }
            ],
            targets: ['player', 'npc'],
            includeInImagePrompt: false,
        });
        saveSettings();
        onRefresh();
    });
    wrap.appendChild(addBtn);

    return wrap;
}

function createCollectionRow(col, index, collections, bulk, onRefresh) {
    const colWrap = document.createElement('div');
    colWrap.className = 'sillynpc-alias-row';
    colWrap.style.marginBottom = '20px';
    colWrap.style.padding = '15px';
    colWrap.style.background = 'var(--sillynpc-bg-secondary)';
    colWrap.style.borderRadius = '8px';
    colWrap.style.border = '1px solid var(--sillynpc-border)';

    colWrap.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:8px; width:100%; margin-bottom:12px;">
            <input type="text" class="text_pole col-name" value="${escapeHtml(col.name)}" placeholder="Collection Name" style="flex:2">
            <input type="text" class="text_pole col-id" value="${escapeHtml(col.id)}" placeholder="id (slug)" style="flex:1">
            <label class="sillynpc-check-group" style="margin-right:10px; cursor:pointer;" title="Visible in Tracker">
                <input type="checkbox" class="col-visible" ${col.visible !== false ? 'checked' : ''}>
                <small>Visible</small>
            </label>
            <label class="sillynpc-check-group" style="margin-right:10px; cursor:pointer;" title="Include this collection's item names in portrait prompts">
                <input type="checkbox" class="col-image-prompt" ${col.includeInImagePrompt !== false ? 'checked' : ''}>
                <small>Image prompt</small>
            </label>
            <button type="button" class="menu_button move-up-btn" title="Move Up" ${index === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
            <button type="button" class="menu_button move-down-btn" title="Move Down" ${index === collections.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
            <button type="button" class="menu_button delete-btn" title="Delete Collection" style="color: var(--sillynpc-danger);"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="col-targets-slot"></div>
        <div style="display:flex; gap:8px; width:100%; align-items:center; margin-bottom:12px;">
            <small class="sillynpc-field-note" title="What this collection holds, in your own words. Sent to the reader with every extraction.">What it holds:</small>
            <input type="text" class="text_pole col-hint" value="${escapeHtml(col.hint || '')}"
                   placeholder="e.g. photographs the player has taken"
                   title="A name is a key, not an explanation - a collection called &quot;pictures&quot; tells the reader as little as a column heading. One short line saying what belongs in it is sent with every extraction. Leave blank if the name speaks for itself."
                   style="flex:1; min-width:120px;">
        </div>
        <div class="fields-container" style="margin-left: 20px; border-left: 2px solid var(--sillynpc-border, rgba(128,128,128,0.25)); padding-left: 15px;">
            <div style="margin-bottom: 8px;"><small class="sillynpc-fields-heading">Fields Configuration</small></div>
            <div class="fields-list"></div>
            <button type="button" class="menu_button add-field-btn" style="font-size:var(--sillynpc-text-md); padding:2px 10px; margin-top:8px;">
                <i class="fa-solid fa-plus"></i> Add Field
            </button>
        </div>
    `;

    wireCollectionControls(colWrap, col, index, collections, bulk, onRefresh);
    return colWrap;
}

function wireCollectionControls(colWrap, col, index, collections, bulk, onRefresh) {
    const fieldsList = colWrap.querySelector('.fields-list');
    const renderFields = () => renderCollectionFields(col, fieldsList, onRefresh);

    colWrap.querySelector('.add-field-btn').addEventListener('click', () => {
        col.fields.push({ name: 'new_field', label: 'New Field', type: 'text' });
        saveSettings();
        renderFields();
    });

    colWrap.querySelector('.col-name').addEventListener('input', (e) => { col.name = e.target.value; saveSettings(); });
    colWrap.querySelector('.col-hint')?.addEventListener('input', (e) => { col.hint = e.target.value; saveSettings(); });
    wireCollectionIdRename(colWrap, col, collections, onRefresh);
    colWrap.querySelector('.col-targets-slot').append(buildCollectionTargetsEditor(col, saveSettings));
    colWrap.querySelector('.col-image-prompt').addEventListener('change', (e) => {
        col.includeInImagePrompt = e.target.checked;
        saveSettings();
    });
    const visibleCheck = colWrap.querySelector('.col-visible');
    if (visibleCheck) {
        visibleCheck.addEventListener('change', (e) => { col.visible = e.target.checked; saveSettings(); onRefresh(); });
    }
    // Through the same rule the stat rows and the collection fields use. The swap was
    // written out here twice; three lists with a pair of buttons each would have made
    // four copies of it to keep right.
    for (const [selector, delta] of [['.move-up-btn', -1], ['.move-down-btn', 1]]) {
        colWrap.querySelector(selector)?.addEventListener('click', () => {
            if (!moveInList(collections, index, delta)) return;
            saveSettings();
            onRefresh();
        });
    }
    colWrap.querySelector('.delete-btn').addEventListener('click', async () => {
        if (await Popup.show.confirm('Delete collection', `Delete "${col.name}"? Its stored items will be left behind.`)) {
            collections.splice(index, 1);
            saveSettings();
            onRefresh();
        }
    });

    if (bulk.isActive()) {
        colWrap.querySelector('.delete-btn')?.replaceWith(buildBulkCheckbox(bulk, index));
    }

    renderFields();
}

function wireCollectionIdRename(colWrap, col, collections, onRefresh) {
    const colIdInput = colWrap.querySelector('.col-id');
    colIdInput.title = 'Storage key for this collection. Renaming it migrates existing items.';
    colIdInput.addEventListener('change', (e) => {
        const oldId = col.id;
        const newId = e.target.value.trim();
        if (!newId || newId === oldId) {
            e.target.value = oldId;
            return;
        }
        if (collections.some(c => c !== col && c.id === newId)) {
            toastr.error(`A collection with the id "${newId}" already exists.`, 'SillyNPC');
            e.target.value = oldId;
            return;
        }
        col.id = newId;
        const moved = renameCollectionId(oldId, newId);
        saveSettings();
        if (moved) {
            toastr.success(`Renamed to "${newId}" and carried ${moved} item${moved === 1 ? '' : 's'} across.`, 'SillyNPC');
        }
        onRefresh();
    });
}
