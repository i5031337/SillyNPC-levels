import { systemStatFields } from '../../core/system-fields.js';
import { projectSystemTracker } from '../../core/system-schema.js';
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

/** Refresh actor views after editing the canonical shared catalogs. */
export function saveSystemEditor(context = liveSystemContext) {
    const definition = context.definition();
    if (definition) {
        definition.hud.playerStatIds = systemStatFields(definition, 'player').filter(field => field.isPrimary).map(field => field.id);
        for (const scope of ['world', 'npc']) {
            const ids = new Set(systemStatFields(definition, scope).map(field => field.id));
            definition.hud[`${scope}StatIds`] = definition.hud[`${scope}StatIds`].filter(id => ids.has(id));
        }
        const projected = projectSystemTracker(definition);
        const tracker = context.getSettings().statusTracker;
        for (const key of ['globalStats', 'playerStats', 'npcStats', 'progression', 'npcTemplates']) tracker[key] = projected[key];
        tracker.characterStats = definition.stats.character;
    }
    context.saveSettings();
}
