import { renderExtensionTemplateAsync } from '../../../../extensions.js';
import { POPUP_TYPE, Popup } from '../../../../popup.js';
import { extensionName, LOG_PREFIX, NPC_LORE_FIELDS } from './constants.js';
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
import { fillProfile, readLoreEntry } from './character-fill.js';
import { readLoreValues } from './lore-sync.js';
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
import { renderManageView } from './ui-manage.js';
import { renderPictureTagsSection } from './ui-manage-pictures.js';
import { renderCollectionsSection, renderCategorySelect } from './ui-manage-collections.js';
import { renderOverridesSection, buildAliasRow } from './ui-manage-overrides.js';


/**
 * The tabs, in their own class.
 *
 * NOT `.sillynpc-tab` with a `data-tab`, which is what the popup's own tab bar uses:
 * setupTabBar binds a click to every one of those inside manageState.manageRoot and renderManageView
 * strips `active` off any whose data-tab is not the open panel. An inner tab wearing that
 * class would switch the whole popup and then lose its own highlight on the next draw.
 *
 * Pictures appears only when something has asked for pictures to be tagged, so the bar is
 * two tabs wide for anybody who has not asked - same rule as the section it replaced, and
 * the reason it is a tab at all is that a grid of eleven thumbnails does not belong in a
 * column beside the aliases and the collections.
 */
function buildViewTabs(char) {
    const bar = document.createElement('div');
    bar.className = 'sillynpc-charview-tabs';

    const views = [['profile', 'Profile'], ['edit', 'Edit']];
    if (taggedFields().length > 0) views.push(['pictures', 'Pictures']);

    for (const [view, label] of views) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'sillynpc-charview-tab' + (manageState.charView === view ? ' active' : '');
        tab.dataset.view = view;
        tab.textContent = label;
        tab.addEventListener('click', () => {
            if (manageState.charView === view) return;
            manageState.charView = view;
            renderEditor();
        });
        bar.append(tab);
    }
    return bar;
}

function buildEditorHeader(char) {
    const header = document.createElement('div');
    header.className = 'sillynpc-editor-header';
    
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'menu_button sillynpc-back-btn';
    backBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Back';
    backBtn.addEventListener('click', () => { manageState.editingCharId = null; renderManageView(); });
    
    const title = document.createElement('h3');
    title.className = 'sillynpc-editor-title';
    title.textContent = char.name || '(unnamed)';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'menu_button sillynpc-delete-btn';
    deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
    deleteBtn.addEventListener('click', async () => {
        if (await Popup.show.confirm(`Delete "${char.name || 'this character'}"?`)) {
            deleteCharacter(char.id); manageState.editingCharId = null; renderManageView();
        }
    });
    
    // Between the title and delete: it acts on this whole card, like they do.
    const fillBtn = document.createElement('button');
    fillBtn.type = 'button';
    fillBtn.className = 'menu_button sillynpc-fill-btn';
    fillBtn.innerHTML = '<i class="fa-solid fa-fill-drip"></i> <span>Fill</span>';
    fillBtn.title = 'Give this character a lore entry, tracker fields and a portrait, '
        + 'reading the story for what is missing.';
    fillBtn.addEventListener('click', () => fillCharacter(char, { onSave: () => renderEditor() }));

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'menu_button sillynpc-export-char-btn';
    exportBtn.innerHTML = '<i class="fa-solid fa-file-export"></i>';
    exportBtn.title = 'Write this character to a file - portraits and lore entry included - '
        + 'so it can be sent to somebody else.';
    exportBtn.addEventListener('click', () => exportCharacterFile([char]));

    header.append(backBtn, title, fillBtn, exportBtn, deleteBtn);

    // Header and tabs travel together so they can stay put while the page scrolls: a long
    // profile used to put Back, Fill and the tab switch off the top of the screen.
    const sticky = document.createElement('div');
    sticky.className = 'sillynpc-editor-sticky';
    sticky.append(header, buildViewTabs(char));

    return { sticky, title };
}

function buildEditorLeft(char) {
    // Left Column
    const left = document.createElement('div');
    left.className = 'sillynpc-editor-left';
    
    // Shared with the player sheet, which has the same picture, gallery and controls.
    const { preview, buttons: imgBtns } = buildPortraitBlock(char, { onChange: renderEditor });
    
    const fitField = document.createElement('div');
    fitField.className = 'sillynpc-editor-field';
    fitField.innerHTML = '<label>Image fit in chat</label>';
    const fitSelect = document.createElement('select');
    fitSelect.className = 'text_pole fit-select';
    fitSelect.innerHTML = `
        <option value="">(use default)</option>
        <option value="contain" ${char.imageFit === 'contain' ? 'selected' : ''}>Show full image</option>
        <option value="cover" ${char.imageFit === 'cover' ? 'selected' : ''}>Fill avatar (crop)</option>
    `;
    fitSelect.addEventListener('change', (e) => { char.imageFit = e.target.value; saveSettings(); });
    fitField.appendChild(fitSelect);
    
    const colorField = document.createElement('div');
    colorField.className = 'sillynpc-editor-field';
    colorField.innerHTML = '<label>Speech color</label>';
    const colorRow = document.createElement('div');
    colorRow.className = 'sillynpc-color-row';
    const colorSwatch = document.createElement('div');
    colorSwatch.className = 'sillynpc-color-swatch';
    colorSwatch.style.backgroundColor = char.color || 'transparent';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'sillynpc-color-input';
    colorInput.value = char.color || '#ffffff';
    colorInput.addEventListener('input', () => { char.color = colorInput.value; colorSwatch.style.backgroundColor = char.color; saveSettings(); });
    const clearColorBtn = document.createElement('button');
    clearColorBtn.type = 'button';
    clearColorBtn.className = 'menu_button clear-color-btn';
    clearColorBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    clearColorBtn.addEventListener('click', () => { char.color = ''; saveSettings(); renderEditor(); });
    colorRow.append(colorSwatch, colorInput, clearColorBtn);
    colorField.appendChild(colorRow);
    
    const catContainer = document.createElement('div');
    catContainer.className = 'sillynpc-editor-field category-field-container';
    
    left.append(preview, imgBtns, fitField, colorField, catContainer);
    
    return { left, catContainer };
}

function buildEditorNameField(char, title) {
    const nameField = document.createElement('div');
    nameField.className = 'sillynpc-editor-field';
    nameField.innerHTML = '<label>Name</label>';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'text_pole name-input';
    nameInput.value = char.name;
    nameInput.placeholder = 'e.g. Herald Vesper';
    nameInput.addEventListener('input', (e) => {
        char.name = e.target.value;
        title.textContent = char.name || '(unnamed)';
        saveSettings();
    });
    /* The lorebook follows the name, but only once you have finished typing it.

       Renaming used to change the settings and nothing else, so the entry kept the title
       and the keywords it was created with - and since keywords are what SillyTavern
       matches on to decide whether an entry fires at all, renaming a character quietly
       switched their lore off. It still answered only to the name they used to have.

       On 'change' rather than 'input': the handler above runs on every keystroke, and
       rewriting a lorebook file per character typed is not something to do to somebody's
       data. The old name survives as a keyword either way - mergeKeywords adds - which is
       right, because the chat above still says it. */
    /* And so does the picture folder. Remembered when editing starts, because by the time
       'change' fires the name - and a folder that was never stored, which follows the name -
       has already moved on, and the old folder could no longer be found. */
    let folderBeforeRename = folderFor(char);
    nameInput.addEventListener('focus', () => { folderBeforeRename = folderFor(char); });
    nameInput.addEventListener('change', () => {
        renameLorebookEntry(char).catch(err =>
            console.error(LOG_PREFIX, 'Could not rename the lorebook entry', err));

        const from = folderBeforeRename;
        folderBeforeRename = folderFor(char);
        if (!from || !char.name.trim()) return;
        moveFolder(char, char.name, { from })
            .then(({ moved, left, refused, folder, note }) => {
                if (note) toastr.info(`About the picture folder: ${note}`, 'SillyNPC', { timeOut: 12000 });
                if (refused) {
                    toastr.warning(`The pictures stay in user/images/${from}/: ${refused}.`, 'SillyNPC');
                    // The folder a refused move leaves in use is the old one.
                    char.imageFolder = from;
                    saveSettings();
                } else if (left.length) {
                    toastr.warning(`Moved ${moved} file(s) to user/images/${folder}/. `
                        + `${left.length} could not be moved and are still in user/images/${from}/.`, 'SillyNPC');
                } else if (moved) {
                    toastr.success(`Moved ${moved} file(s) to user/images/${folder}/.`, 'SillyNPC');
                }
                folderBeforeRename = folderFor(char);
            })
            .catch(err => {
                console.error(LOG_PREFIX, 'Could not move the picture folder', err);
                toastr.error(`The pictures could not be moved: ${err?.message ?? err}`, 'SillyNPC');
            });
    });
    nameField.appendChild(nameInput);
    
    return nameField;
}

function renderEditForm(char, editView, sticky, title) {
    const main = document.createElement('div');
    main.className = 'sillynpc-editor-main';

    const { left, catContainer } = buildEditorLeft(char);

    const vDivider = document.createElement('div');
    vDivider.className = 'sillynpc-editor-vdivider';

    // Right Column
    const right = document.createElement('div');
    right.className = 'sillynpc-editor-right';

    const nameField = buildEditorNameField(char, title);

    const profileContainer = document.createElement('div');
    profileContainer.className = 'sillynpc-editor-field profile-field-container';

    const loreContainer = document.createElement('div');
    loreContainer.className = 'lorebook-section-container';
    
    const aliasField = document.createElement('div');
    aliasField.className = 'sillynpc-editor-field';
    aliasField.innerHTML = `
        <div class="sillynpc-aliases-header">
            <label>Name patterns (aliases)</label>
            <small class="notes">Extra names that should also resolve to this character.</small>
        </div>
    `;
    const aliasList = document.createElement('div');
    aliasList.className = 'sillynpc-alias-list';
    char.aliases.forEach((alias, i) => aliasList.appendChild(buildAliasRow(char, i)));
    
    const addAliasBtn = document.createElement('button');
    addAliasBtn.type = 'button';
    addAliasBtn.className = 'menu_button add-alias-btn';

    addAliasBtn.style.whiteSpace = 'nowrap';
    addAliasBtn.style.width = 'fit-content';

    addAliasBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add alias';
    addAliasBtn.style.whiteSpace = 'nowrap';
    addAliasBtn.style.width = 'auto';
    addAliasBtn.style.minWidth = 'max-content';
    addAliasBtn.addEventListener('click', () => {
        char.aliases.push({ pattern: '', isRegex: false }); saveSettings(); renderEditor();
    });
    aliasField.append(aliasList, addAliasBtn);
    
    const overridesContainer = document.createElement('div');
    overridesContainer.className = 'sillynpc-editor-field overrides-field-container';

    const collectionsContainer = document.createElement('div');
    collectionsContainer.className = 'sillynpc-editor-field collections-field-container';
    
    const narrativeEditor = document.createElement('section');
    narrativeEditor.className = 'sillynpc-narrative-editor';
    const narrativeHeading = document.createElement('h3');
    narrativeHeading.textContent = 'Description & Lore';
    narrativeEditor.append(narrativeHeading, profileContainer, loreContainer);
    right.append(nameField, aliasField, narrativeEditor, overridesContainer,
        collectionsContainer);
    
    main.append(left, vDivider, right);
    editView.append(sticky, main);

    renderCategorySelect(char, catContainer);
    renderProfileFields(char, profileContainer);
    if (char.lorebook?.world) readLoreEntry(char).then(content => {
        if (!content || !profileContainer.isConnected) return;
        const merged = readLoreValues(content, char.profile);
        if (!merged) return;
        const missing = NPC_LORE_FIELDS.filter(field => !char.profile?.[field.id] && merged[field.id]);
        if (!missing.length) return;
        char.profile ||= {};
        for (const field of missing) char.profile[field.id] = merged[field.id];
        saveSettings();
        renderProfileFields(char, profileContainer);
    });
    renderLorebookSection(char, loreContainer, { onChange: renderEditor, label: 'Linked lorebook entry' });
    renderOverridesSection(char, overridesContainer);
    renderCollectionsSection(char, collectionsContainer);
}

export function renderEditor() {
    const char = findCharacter(manageState.editingCharId);
    if (!char) { manageState.editingCharId = null; renderManageView(); return; }

    const editView = manageState.manageRoot.querySelector('#sillynpc-editor-view');
    if (!editView) return;
    editView.replaceChildren();

    // Resolve a removed Pictures tab before building the tab bar.
    if (manageState.charView === 'pictures' && taggedFields().length === 0) manageState.charView = 'profile';
    const { sticky, title } = buildEditorHeader(char);

    if (manageState.charView === 'profile') {
        const view = document.createElement('div');
        editView.append(sticky, view);
        renderProfileView(char, view)
            .catch(err => console.error(LOG_PREFIX, 'renderProfileView failed', err));
        return;
    }

    if (manageState.charView === 'pictures') {
        const view = document.createElement('div');
        view.className = 'sillynpc-charview-body';
        editView.append(sticky, view);
        renderPictureTagsSection(char, view);
        return;
    }

    renderEditForm(char, editView, sticky, title);
}

/**
 * What each of this character's pictures means.
 *
 * Drawn only when something has asked for pictures to be tagged. SillyNPC has no use for
 * a tag of its own, so with nothing registered this is not an empty section with a promise
 * in it - it is not there at all, and the character page looks exactly as it did.
 *
 * A grid rather than a control on the portrait carousel. The carousel shows one picture at
 * a time, which is right for choosing the one in use and wrong for saying what a dozen of
 * them are for - and it is shared with the player sheet, which has no tags.
 */
