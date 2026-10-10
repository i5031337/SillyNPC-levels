import { constrainNumericStat } from '../../tracker/numeric-stat-bounds.js';
import { choiceOptionsHtml, isChoiceField } from '../shared/ui-choice.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { isStaticField } from '../../core/constants.js';
import { loadStateFromMetadata, saveStateToMetadata, addItem, removeItem, updateMasterItem, renameMasterItem } from '../../tracker/status-logic.js';
import { eventSource } from '../../../../../../events.js';
import { escapeHtml } from '../../core/utils.js';
import { Popup } from '../../../../../../popup.js';
import { syncNpcCollectionsToCards } from '../../tracker/npc-collections.js';

export function renderCollectionUI(tabId, actor, settings, options = {}) {
    const colDef = settings.collections.find(c => c.id === tabId);
    if (!colDef) return '';

    const items = (actor.collections && actor.collections[tabId]) || [];
    const isEditMode = options.isEditMode !== false; // default true
    return `
        <div class="sillynpc-collection-container">
            <div class="sillynpc-collection-actions" style="display:flex; gap:10px; margin-bottom: 10px;">
                ${isEditMode ? `<button type="button" class="menu_button sillynpc-add-item" data-col="${escapeHtml(tabId)}" style="white-space: nowrap; width: auto; min-width: max-content;">Add New Item</button>` : ''}
            </div>
            <div class="sillynpc-collection-list">
                ${items.map((item, idx) => `
                    <div class="sillynpc-item-card ${isEditMode ? '' : 'readonly-mode'}" data-idx="${idx}" data-col="${escapeHtml(tabId)}">
                        <div class="item-header" style="display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap;">
                            ${colDef.fields.filter(f => !f.isMultiline).map(f => {
                                const val = item[f.name] !== undefined ? item[f.name] : (f.defaultValue !== undefined ? f.defaultValue : (f.type === 'number' ? 0 : ''));
                                if (!isEditMode) {
                                    const width = f.isPrimary ? 'flex:1; min-width:150px;' : 'width:auto; min-width:80px;';
                                    return `
                                        <div class="readonly-field" style="${width}">
                                            <div class="field-label">${escapeHtml(f.label || f.name)}</div>
                                            <div class="field-value">${f.type === 'boolean' ? (val ? 'Yes' : 'No') : escapeHtml(String(val))}</div>
                                        </div>
                                    `;
                                } else {
                                    if (isChoiceField(f)) {
                                        const width = f.isPrimary ? 'flex:1; min-width:150px;' : 'width:110px;';
                                        return `<select class="text_pole item-field-input"
                                                        data-field="${escapeHtml(f.name)}"
                                                        style="${width}">${choiceOptionsHtml(f.options, val)}</select>`;
                                    }
                                    if (f.type === 'boolean') {
                                        return `
                                            <label style="display:flex; align-items:center; gap:5px;">
                                                <input type="checkbox" class="item-field-input" data-field="${escapeHtml(f.name)}" ${val ? 'checked' : ''}>
                                                <small>${escapeHtml(f.label || f.name)}</small>
                                            </label>
                                        `;
                                    }
                                    const width = f.isPrimary ? 'flex:1; min-width:150px;' : 'width:80px;';
                                    return `<input type="${f.type === 'number' ? 'number' : 'text'}"
                                                   ${f.type === 'number' ? `step="any" min="${escapeHtml(f.min ?? '')}" max="${escapeHtml(f.maxStatValue ?? '')}"` : ''}
                                                   class="text_pole item-field-input" 
                                                   data-field="${escapeHtml(f.name)}" 
                                                   value="${escapeHtml(String(val))}" 
                                                   placeholder="${escapeHtml(f.label || f.name)}" 
                                                   style="${width}">`;
                                }
                            }).join('')}
                            ${isEditMode ? `
                            <div class="item-actions" style="margin-left:auto;">
                                <button type="button" class="menu_button drop-item" title="Delete entry"><i class="fa-solid fa-trash" aria-hidden="true"></i> Delete</button>
                            </div>
                            ` : ''}
                        </div>
                        ${colDef.fields.filter(f => f.isMultiline).map(f => {
                            const val = item[f.name] || '';
                            if (!isEditMode) {
                                return `
                                    <div class="readonly-field multiline" style="width: 100%; margin-top: 8px;">
                                        <div class="field-label">${escapeHtml(f.label || f.name)}</div>
                                        <div class="field-value">${escapeHtml(val)}</div>
                                    </div>
                                `;
                            } else {
                                return `<textarea class="text_pole item-field-input" 
                                                 data-field="${escapeHtml(f.name)}" 
                                                 placeholder="${escapeHtml(f.label || f.name)}" 
                                                 style="width: 100%; margin-top: 8px; resize: vertical; min-height: 40px;">${escapeHtml(val)}</textarea>`;
                            }
                        }).join('')}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

/**
 * Where an edit to this actor's belongings should be written.
 *
 * The handlers used to look the character up in the chat state and give up when they were
 * not there - so editing the belongings of anyone not in the current scene did nothing at
 * all. Delete never even asked; typed text stayed on screen until the panel redrew from
 * the card, and then reverted. The character page hands in a card-backed actor for exactly
 * that case, and this stops it being thrown away.
 *
 * @param {object} actor The actor the editor was opened with.
 * @param {boolean} isPlayer
 * @returns {{ target: object|null, state: object|null, offstage: boolean }}
 *   `state` is null off stage - there is no scene copy to write, only the card.
 */
export function resolveCollectionTarget(actor, isPlayer) {
    const state = loadStateFromMetadata();
    const inScene = isPlayer
        ? state.player
        : (state.characters || []).find(c => c.name?.toLowerCase() === actor.name?.toLowerCase());

    if (inScene) return { target: inScene, state, offstage: false };

    // Not in the scene. The card is the only copy, and it is what seeds them when they
    // next walk in - so it is the right thing to edit, not a dead end.
    return { target: actor || null, state: null, offstage: true };
}

/**
 * Writes a belongings edit where it belongs, and tells the rest of the app only if it
 * matters.
 *
 * @param {string} label For the tracker's undo history.
 * @param {{state: object|null, offstage: boolean}} where From resolveCollectionTarget.
 * @param {boolean} isPlayer
 */
export function persistCollectionEdit(label, { target, state, offstage }, isPlayer) {
    if (offstage) {
        // saveSettings also persists chat-owned cards; the scene needs no redraw.
        saveSettings();
        return;
    }
    if (!isPlayer) syncNpcCollectionsToCards([target]);
    saveStateToMetadata(state, { label });
    eventSource.emit('sillynpc-status-updated', state, { source: 'collection-editor' });
}

/**
 * Attaches event listeners for collection UI.
 * @param {HTMLElement} dom Container element
 * @param {Object} actor Actor object to update
 * @param {Function} onRefresh Refreshes the UI; may return its replacement container.
 */
export function attachCollectionListeners(dom, actor, onRefresh) {
    const isPlayer = actor.isPlayer ?? (actor === loadStateFromMetadata().player);

    const persist = (label, where) => persistCollectionEdit(label, where, isPlayer);

    // Collection Actions
    dom.querySelectorAll('.sillynpc-add-item').forEach(btn => {
        if (btn.dataset.listenerAttached) return;
        btn.addEventListener('click', () => {
            const colId = btn.dataset.col;
            const settings = getSettings().statusTracker;
            const colDef = settings.collections.find(c => c.id === colId);
            if (!colDef) return;
            const primaryField = colDef.fields.find(f => f.isPrimary) || { name: 'name' };
            const where = resolveCollectionTarget(actor, isPlayer);
            if (!where.target) return;

            // Adds require a name; use a unique placeholder so repeated clicks create rows.
            const items = where.target.collections?.[colId] || [];
            const newIndex = items.length;
            const names = new Set(items.map(item => String(item[primaryField.name]).toLowerCase()));
            let newItemName = 'New Item';
            for (let suffix = 2; names.has(newItemName.toLowerCase()); suffix++) {
                newItemName = `New Item ${suffix}`;
            }
            addItem(where.target, colId, { [primaryField.name]: newItemName });
            // A decision, not a reading of the state: authoritative, or the merge
            // guard puts back whatever master still remembers.
            persist('Item added', where);
            const refreshedDom = onRefresh?.() || dom;
            const addedCard = [...refreshedDom.querySelectorAll('.sillynpc-item-card')]
                .find(card => card.dataset.col === colId && Number(card.dataset.idx) === newIndex);
            const nameInput = [...(addedCard?.querySelectorAll('.item-field-input') || [])]
                .find(input => input.dataset.field === primaryField.name);
            nameInput?.focus();
            nameInput?.select?.();
        });
        btn.dataset.listenerAttached = 'true';
    });

    // Persisting on every keystroke was expensive and destructive: each character
    // typed deep-cloned the whole state into the history array, deep-cloned it again
    // into persona master storage, and emitted sillynpc-status-updated -- which
    // reprocesses every message in the chat. Typing a 13-character item name did all
    // of that 13 times, and renameMasterItem() left a Master DB entry for every
    // intermediate prefix ("s", "sw", "swo", ...).
    //
    // Now the write is debounced and also flushed on 'change' (blur/Enter), so a
    // rename is committed once, with its final value.
    const COMMIT_DELAY_MS = 400;

    const commitField = (input) => {
        const card = input.closest('.sillynpc-item-card');
        if (!card) return;
        const colId = card.dataset.col;
        const idx = parseInt(card.dataset.idx);
        const fieldName = input.dataset.field;

        const settings = getSettings().statusTracker;
        const colDef = settings.collections.find(c => c.id === colId);
        const primaryField = colDef?.fields.find(f => f.isPrimary) || { name: 'name' };
        const fieldDef = colDef ? colDef.fields.find(f => f.name === fieldName) : null;

        const where = resolveCollectionTarget(actor, isPlayer);
        const items = where.target?.collections?.[colId];
        if (!items || !items[idx]) return;

        let value = input.value;
        if (input.type === 'checkbox') value = input.checked;
        else if (input.type === 'number') {
            const bounded = constrainNumericStat(fieldDef, input.value === '' ? 0 : input.value, items[idx][fieldName]);
            value = parseFloat(bounded) || 0;
            input.value = String(value);
        }

        // Nothing settled since the last commit - skip the whole write.
        if (items[idx][fieldName] === value) return;

        const oldName = items[idx][primaryField.name];
        items[idx][fieldName] = value;
        const newItem = items[idx];
        const newName = newItem[primaryField.name];

        // Master Database Updates
        const isPrimary = primaryField.name === fieldName;
        const isStatic = fieldDef ? isStaticField(fieldDef) : false;

        if (isPrimary && oldName !== newName) {
            renameMasterItem(colId, oldName, newName, newItem);
        } else if (isStatic) {
            updateMasterItem(colId, newName, newItem);
        }

        // A rename removes one key and adds another, so without this the old name is
        // merged back from master and the item exists twice.
        persist('Item edited', where);
    };

    dom.querySelectorAll('.item-field-input').forEach(input => {
        if (input.dataset.listenerAttached) return;

        let timer = null;
        const flush = () => {
            if (timer) { clearTimeout(timer); timer = null; }
            commitField(input);
        };

        input.addEventListener('input', () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(flush, COMMIT_DELAY_MS);
        });
        // Blur, Enter, and checkbox/select toggles commit immediately.
        input.addEventListener('change', flush);
        input.addEventListener('blur', flush);

        input.dataset.listenerAttached = 'true';
    });

    dom.querySelectorAll('.drop-item').forEach(btn => {
        if (btn.dataset.listenerAttached) return;
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const card = btn.closest('.sillynpc-item-card');
            const colId = card.dataset.col;
            const idx = parseInt(card.dataset.idx);

            const where = resolveCollectionTarget(actor, isPlayer);
            const items = where.target?.collections?.[colId];

            if (items && items[idx]) {
                const item = items[idx];
                const settings = getSettings().statusTracker;
                const colDef = settings.collections.find(c => c.id === colId);
                const primaryField = colDef?.fields.find(f => f.isPrimary) || { name: 'name' };
                const itemName = item[primaryField.name] || 'Item';

                if (await Popup.show.confirm('Delete item', `Delete "${itemName}"?`)) {
                    // Take it off this character, and leave the library alone: dropping a
                    // sword should not delete what a sword is for everyone else.
                    // The tombstone that stops an item creeping back is about this chat,
                    // so it is only worth writing for someone who is in it.
                    removeItem(where.target, colId, itemName, !where.offstage);
                    // Authoritative, or the merge guard restores it from master and the
                    // deletion appears to do nothing at all.
                    persist('Item dropped', where);
                    onRefresh?.();
                }
            }
        });
        btn.dataset.listenerAttached = 'true';
    });
}
