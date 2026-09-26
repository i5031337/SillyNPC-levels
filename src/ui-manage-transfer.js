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
import { renderManageView } from './ui-manage.js';

export function exportData() {
    offerDownload(exportSettingsData(),
        `sillynpc-export-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const confirm = await Popup.show.confirm('Import Data', 'This will overwrite your current SillyNPC characters and settings. Continue?');
            if (!confirm) return;

            importSettingsData(text);
            renderManageView();
            toastr.success('Imported successfully.');
        } catch (err) {
            console.error(LOG_PREFIX, 'Import failed', err);
            toastr.error(`Import failed: ${err.message}`);
        }
    };
    input.click();
}
