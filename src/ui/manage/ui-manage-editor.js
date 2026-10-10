import { buildNpcTemplateSelect } from '../characters/ui-npc-template.js';
import { Popup } from '../../../../../../popup.js';
import { LOG_PREFIX } from '../../core/constants.js';
import { profileFieldsForCard, profileFieldValue } from '../../core/profile-fields.js';
import { saveSettings } from '../../core/settings.js';
import { deleteCharacter, findCharacter, assignMatchingTrackerTemplate } from '../../characters/characters.js';
import { triggerReprocess } from '../../chat/reprocess.js';
import { renameLorebookEntry } from '../../lore/lorebook.js';
import { buildPortraitBlock } from '../characters/ui-portrait.js';
import { buildExpressionsSection } from '../characters/ui-expressions.js';
import { buildVoicesSection } from '../characters/ui-voices.js';
import { taggedFields } from '../../characters/image-tags.js';
import { folderFor, moveFolder } from '../../characters/character-images.js';
import { renderLorebookSection } from '../story/ui-lorebook-section.js';
import { renderProfileView, renderProfileFields } from '../characters/ui-profile.js';
import { fillCharacter } from '../characters/ui-fill.js';
import { readLoreEntry } from '../../characters/character-fill.js';
import { readLoreValues } from '../../lore/lore-sync.js';
import { exportCharacterFile } from '../shared/ui-transfer.js';
import { manageState } from './ui-manage-state.js';
import { renderPictureTagsSection } from './ui-manage-pictures.js';
import { renderCollectionsSection, renderCategorySelect } from './ui-manage-collections.js';
import { renderOverridesSection, buildAliasRow, commitStatEdits } from './ui-manage-overrides.js';
import { buildManualLevelUpSection } from '../characters/ui-manual-level-up.js';
import { buildProfileSection } from '../characters/ui-profile-sections.js';
import { renderCharacterMemorySection } from '../characters/ui-character-memory-section.js';
import { eventSource } from '../../../../../../events.js';

/** Inner tabs use separate selectors from the popup's main navigation. */
function buildViewTabs(viewState, refreshEditor, { pictures = true } = {}) {
    const bar = document.createElement('div');
    bar.className = 'sillynpc-charview-tabs';

    const views = [['profile', 'Profile'], ['edit', 'Edit']];
    if (pictures && taggedFields().length > 0) views.push(['pictures', 'Pictures']);

    for (const [view, label] of views) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'sillynpc-charview-tab' + (viewState.charView === view ? ' active' : '');
        tab.dataset.view = view;
        tab.textContent = label;
        tab.addEventListener('click', () => {
            if (viewState.charView === view) return;
            viewState.charView = view;
            refreshEditor();
        });
        bar.append(tab);
    }
    return bar;
}

function actionButton(className, icon, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `menu_button ${className}`;
    button.innerHTML = `<i class="fa-solid ${icon}"></i>${label ? ` <span>${label}</span>` : ''}`;
    button.addEventListener('click', onClick);
    return button;
}

function buildEditorHeader(char, showGrid, refreshEditor, viewState) {
    const header = document.createElement('div');
    header.className = 'sillynpc-editor-header';
    const title = document.createElement('h3');
    title.className = 'sillynpc-editor-title';
    title.textContent = char.name || '(unnamed)';
    const fill = actionButton('sillynpc-fill-btn', 'fa-fill-drip', 'Fill',
        () => fillCharacter(char, { onSave: () => refreshPortrait(char, refreshEditor) }));
    fill.title = 'Write missing profile details and lore, then offer a portrait.';
    if (!char.isPlayer) header.append(actionButton('sillynpc-back-btn', 'fa-arrow-left', 'Back',
        () => { manageState.editingCharId = null; showGrid(); }));
    header.append(title, fill);
    if (!char.isPlayer) {
        const exportButton = actionButton('sillynpc-export-char-btn', 'fa-file-export', '', () => exportCharacterFile([char]));
        exportButton.title = 'Export this character, including portraits and lore.';
        const deleteButton = actionButton('sillynpc-delete-btn', 'fa-trash', '', async () => {
            if (await Popup.show.confirm(`Delete "${char.name || 'this character'}"?`)) {
                deleteCharacter(char.id); manageState.editingCharId = null; showGrid();
            }
        });
        deleteButton.title = 'Delete character';
        header.append(exportButton, deleteButton);
    }
    const sticky = document.createElement('div');
    sticky.className = 'sillynpc-editor-sticky';
    sticky.append(header, buildViewTabs(viewState, refreshEditor, { pictures: !char.isPlayer }));
    return { sticky, title };
}

function buildEditorLeft(char, refreshEditor) {
    // Left Column
    const left = document.createElement('div');
    left.className = 'sillynpc-editor-left';

    // Shared with the player sheet, which has the same picture, gallery and controls.
    const { preview, buttons: imgBtns } = buildPortraitBlock(char, { onChange: () => refreshPortrait(char, refreshEditor) });
    left.append(preview, imgBtns);
    if (char.isPlayer) return { left };

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
    clearColorBtn.addEventListener('click', () => { char.color = ''; saveSettings(); refreshEditor(); });
    colorRow.append(colorSwatch, colorInput, clearColorBtn);
    colorField.appendChild(colorRow);

    const catContainer = document.createElement('div');
    catContainer.className = 'sillynpc-editor-field category-field-container';

    left.append(fitField, colorField, catContainer, buildExpressionsSection(char), buildVoicesSection(char));

    return { left, catContainer };
}

function buildEditorNameField(char, title, refreshEditor) {
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
    // Rename linked lore and picture folders only after the name edit finishes.
    // Capture the old folder before keystrokes change its inferred path.
    let folderBeforeRename = folderFor(char);
    nameInput.addEventListener('focus', () => { folderBeforeRename = folderFor(char); });
    nameInput.addEventListener('change', () => {
        if (assignMatchingTrackerTemplate(char)) {
            saveSettings();
            triggerReprocess();
            refreshEditor();
        }
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

function buildAliasesField(char, refreshEditor) {
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
    (char.aliases || []).forEach((alias, i) => aliasList.appendChild(buildAliasRow(char, i, refreshEditor)));

    const addAliasBtn = document.createElement('button');
    addAliasBtn.type = 'button';
    addAliasBtn.className = 'menu_button add-alias-btn';

    addAliasBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add alias';
    addAliasBtn.style.whiteSpace = 'nowrap';
    addAliasBtn.style.width = 'auto';
    addAliasBtn.style.minWidth = 'max-content';
    addAliasBtn.addEventListener('click', () => {
        char.aliases.push({ pattern: '', isRegex: false }); saveSettings(); refreshEditor();
    });
    aliasField.append(aliasList, addAliasBtn);

    return aliasField;
}

function renderEditForm(char, editView, sticky, title, refreshEditor) {
    const main = document.createElement('div');
    main.className = 'sillynpc-editor-main';

    const { left, catContainer } = buildEditorLeft(char, refreshEditor);

    const vDivider = document.createElement('div');
    vDivider.className = 'sillynpc-editor-vdivider';

    // Right Column
    const right = document.createElement('div');
    right.className = 'sillynpc-editor-right';

    const nameField = char.isPlayer ? document.createElement("p") : buildEditorNameField(char, title, refreshEditor);
    if (char.isPlayer) {
        nameField.className = "notes";
        nameField.textContent = `Playing as ${char.name}. Name and identity follow the selected SillyTavern persona.`;
    }

    const profileContainer = document.createElement('div');
    profileContainer.className = 'sillynpc-editor-field profile-field-container';

    const loreContainer = document.createElement('div');
    loreContainer.className = 'lorebook-section-container';

    const overridesContainer = document.createElement('div');
    overridesContainer.className = 'sillynpc-editor-field overrides-field-container';

    const collectionsContainer = document.createElement('div');
    collectionsContainer.className = 'sillynpc-editor-field collections-field-container';

    const identity = buildProfileSection('edit:identity', 'Identity', { open: true });
    identity.body.append(nameField);
    if (!char.isPlayer) identity.body.append(buildAliasesField(char, refreshEditor));
    const stats = buildProfileSection('stats', 'Stats', { open: true });
    stats.body.append(overridesContainer);
    const lore = buildProfileSection('lore', 'Lore');
    lore.body.classList.add('sillynpc-narrative-editor');
    lore.body.append(profileContainer, loreContainer);
    left.append(identity.section);
    right.append(stats.section, collectionsContainer, lore.section);

    main.append(left, vDivider, right);
    editView.append(sticky, main);

    if (!char.isPlayer) renderCategorySelect(char, catContainer, refreshEditor);
    renderProfileFields(char, profileContainer);
    if (char.lorebook?.world) readLoreEntry(char).then(content => {
        if (!content || !profileContainer.isConnected) return;
        const merged = readLoreValues(content, char.profile, char.isPlayer ? 'player' : 'npc');
        if (!merged) return;
        const missing = profileFieldsForCard(char).filter(field =>
            !profileFieldValue(char.profile, field) && profileFieldValue(merged, field));
        if (!missing.length) return;
        char.profile ||= {};
        for (const field of missing) char.profile[field.id] = profileFieldValue(merged, field);
        saveSettings();
        renderProfileFields(char, profileContainer);
    });
    renderLorebookSection(char, loreContainer, { onChange: refreshEditor, label: 'Linked lorebook entry' });
    renderOverridesSection(char, overridesContainer);
    if (!char.isPlayer) overridesContainer.append(buildManualLevelUpSection(char, { onChange: refreshEditor }));
    renderCollectionsSection(char, collectionsContainer);
    renderCharacterMemorySection(char, right);
}

function refreshPortrait(char, refreshEditor) {
    refreshEditor();
    if (char.isPlayer) eventSource.emit('sillynpc-player-portrait-changed');
}

/** Player and NPC Cast pages share their layout; ownership remains actor-specific. */
export function renderCharacterEditor(char, editView, { showGrid = () => {}, viewState = manageState } = {}) {
    const refreshEditor = () => {
        commitStatEdits(editView);
        renderCharacterEditor(char, editView, { showGrid, viewState });
    };
    editView.replaceChildren();
    if (viewState.charView === 'pictures' && (char.isPlayer || taggedFields().length === 0)) viewState.charView = 'profile';
    const { sticky, title } = buildEditorHeader(char, showGrid, refreshEditor, viewState);
    if (!char.isPlayer) sticky.appendChild(buildNpcTemplateSelect(char, refreshEditor));

    if (viewState.charView === 'profile') {
        const view = document.createElement('div');
        editView.append(sticky, view);
        renderProfileView(char, view).catch(err => console.error(LOG_PREFIX, 'renderProfileView failed', err));
    } else if (viewState.charView === 'pictures') {
        const view = document.createElement('div');
        view.className = 'sillynpc-charview-body';
        editView.append(sticky, view);
        renderPictureTagsSection(char, view, refreshEditor);
    } else {
        renderEditForm(char, editView, sticky, title, refreshEditor);
    }
}

export function renderEditor(showGrid) {
    const char = findCharacter(manageState.editingCharId);
    if (!char) { manageState.editingCharId = null; showGrid(); return; }
    const editView = manageState.manageRoot.querySelector('#sillynpc-editor-view');
    if (editView) renderCharacterEditor(char, editView, { showGrid });
}
