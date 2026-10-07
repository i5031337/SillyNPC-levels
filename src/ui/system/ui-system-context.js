import { getSettings, saveSettings } from '../../core/settings.js';
import { renameStat, renameCollectionId, renameCollectionField } from '../../tracker/status-logic.js';
import { updateHUD } from '../hud/ui-hud.js';
import { refreshMemoryButton } from '../tracker/ui-memory-button.js';
export const liveSystemContext = {
    getSettings, saveSettings, refreshMemoryButton, renameStat, renameCollectionId, renameCollectionField, updateHUD,
    definition: () => {
        const settings = getSettings();
        return settings.statusTracker.presets?.[settings.activeSystem]?.definition;
    },
    bulkBars: new Map(),
};
