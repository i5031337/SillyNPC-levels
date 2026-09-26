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

export function renderCollectionsSection(char, container) {
    if (!container) return;
    
    const settings = getSettings().statusTracker;
    const collections = settings.collections.filter(col => col.target === 'npc' || col.target === 'all');
    
    if (collections.length === 0) return;

    container.innerHTML = `
        <div class="sillynpc-aliases-header">
            <label>Current Collections</label>
            <small class="notes">Manage inventory and other collections for this NPC in the current chat.</small>
        </div>
        <div class="sillynpc-npc-collections-tabs sillynpc-sheet-tabs" style="margin-top: 10px;">
            ${collections.map((col, idx) => `
                <div class="sillynpc-tab ${idx === 0 ? 'active' : ''}" data-tab="${escapeHtml(col.id)}">${escapeHtml(col.name)}</div>
            `).join('')}
        </div>
        <div class="sillynpc-npc-collections-content" style="margin-top: 10px;">
            <!-- Collection UI will be rendered here -->
        </div>
    `;

    const contentArea = container.querySelector('.sillynpc-npc-collections-content');
    const tabs = container.querySelectorAll('.sillynpc-tab');
    
    let currentCollectionId = collections[0].id;

    // Off by default every time the editor opens: seeing a card's stored belongings is
    // a deliberate act, not a mode you can forget you left on.
    let editOffstage = false;

    /** Holds the ticked rows across the redraws that ticking one causes. */
    let collectionBulk = null;

    const refreshCollection = () => {
        const state = loadStateFromMetadata();
        const charInState = state.characters.find(c => c.name.toLowerCase() === char.name.toLowerCase());

        // Off stage, the character's belongings still exist - they are kept on the card as
        // statusCollections, which is what seeds them when they next walk into a scene. The
        // editor used to refuse to show them at all, so the only way to correct an
        // inventory was to drag the character into the scene first.
        if (!charInState && !editOffstage) {
            const notice = document.createElement('p');
            notice.className = 'notes';
            notice.textContent = `${char.name || 'This character'} is not in the current scene, `
                + 'so these are the belongings stored on their card rather than live values.';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'menu_button';
            btn.innerHTML = '<i class="fa-solid fa-pen"></i> Edit stored collections';
            btn.addEventListener('click', async () => {
                const ok = await Popup.show.confirm(
                    'Edit belongings for a character who is not in the scene?',
                    'These are the values stored on the card. They are copied into the scene '
                    + 'the next time this character appears, so an edit made now is what they '
                    + 'will arrive with. If they are already in another chat, that chat keeps '
                    + 'its own live values and is not changed.',
                );
                if (!ok) return;
                editOffstage = true;
                refreshCollection();
            });

            contentArea.replaceChildren(notice, btn);
            return;
        }

        // A card-backed actor, shaped like a scene one so the same renderer and listeners
        // work unchanged rather than needing an off-stage variant.
        const actor = charInState || {
            name: char.name,
            stats: char.statusOverrides || {},
            collections: char.statusCollections || (char.statusCollections = {}),
        };

        // Built once per editor rather than per redraw: the handle holds the selection,
        // and rebuilding it with the panel would forget every tick.
        if (!collectionBulk) {
            collectionBulk = buildBulkBar({
                noun: 'item',
                allIds: () => {
                    const list = resolveCollectionTarget(actor, false).target
                        ?.collections?.[currentCollectionId] || [];
                    return list.map((_, i) => i);
                },
                onDelete: (ids) => {
                    const where = resolveCollectionTarget(actor, false);
                    const list = where.target?.collections?.[currentCollectionId];
                    if (!list) return;
                    // Descending, or the first splice shifts every index chosen after it.
                    const removed = spliceIndexes(list, ids);
                    persistCollectionEdit(`Dropped ${removed} item(s)`, where, false);
                },
                onRefresh: () => refreshCollection(),
            });
        }

        contentArea.innerHTML = renderCollectionUI(currentCollectionId, actor, settings, {
            bulk: collectionBulk,
        });
        attachCollectionListeners(contentArea, actor, () => {
            // Edits to a card-backed actor have to be written back to the card; a scene
            // actor is already part of the state the tracker saves.
            if (!charInState) saveSettings();
            refreshCollection();
        }, collectionBulk);
    };


    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentCollectionId = tab.dataset.tab;
            refreshCollection();
        });
    });

    refreshCollection();
}

export function renderCategorySelect(char, container) {
    if (!container) return;
    container.innerHTML = `<label>Category</label><select class="text_pole category-select"></select>`;
    const select = container.querySelector('select');
    const categories = getAllCategories();
    
    let html = `<option value="">(none)</option>`;
    categories.forEach(cat => html += `<option value="${escapeHtml(cat)}" ${char.category === cat ? 'selected' : ''}>${escapeHtml(cat)}</option>`);
    if (char.category && !categories.includes(char.category)) {
        html += `<option value="${escapeHtml(char.category)}" selected>${escapeHtml(char.category)}</option>`;
    }
    html += `<option value="__new__">+ New category…</option>`;
    select.innerHTML = html;

    select.addEventListener('change', async () => {
        if (select.value === '__new__') {
            const name = (await Popup.show.input('New category', 'Enter a name:'))?.trim();
            if (name) {
                // Into the register as well as onto this character, or the category would
                // last only as long as they stayed in it.
                createCategory(name);
                char.category = name;
                saveSettings();
            }
            renderEditor();
        } else {
            char.category = select.value; saveSettings();
        }
    });
}

