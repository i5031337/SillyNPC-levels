import { debugLog } from './constants.js';

export function migratePresetsAndStores(settings, currentVersion) {
    debugLog('Presets migration');
    // Phase 5 Migration: Old presets to System Profiles
    if (settings.statusTracker.presets && typeof settings.statusTracker.presets === 'object') {
        const legacyThemeMap = {
            'modern': 'modern-dark',
            'minimal': 'default',
            'compact': 'default'
        };
        for (const [name, preset] of Object.entries(settings.statusTracker.presets)) {
            if (!preset) continue; // Skip null presets
            // If it doesn't have a 'metadata' or 'config' field, it's an old preset
            if (!preset.config || !preset.metadata) {
                debugLog(`Migrating legacy preset "${name}" to System Profile format.`);
                const profile = {
                    version: '2.0.0',
                    metadata: {
                        name: name,
                        description: 'Migrated from legacy preset.',
                        author: 'System'
                    },
                    config: {
                        globalStats: preset.globalStats || [],
                        npcStats: preset.npcStats || preset.characterStats || [],
                        playerStats: preset.playerStats || [],
                        collections: preset.collections || [],
                        profileHints: settings.profileHints || {},
                        displayStyle: settings.statusTracker.displayStyle,
                        template: settings.statusTracker.template,
                        customCSS: settings.statusTracker.customCSS,
                        sceneBindingStat: settings.statusTracker.sceneBindingStat,
                        hudEnabled: settings.statusTracker.hudEnabled,
                        hudPosition: settings.statusTracker.hudPosition,
                        hudScale: settings.statusTracker.hudScale
                    }
                };
                settings.statusTracker.presets[name] = profile;
            }
            const migratedPreset = settings.statusTracker.presets[name];
            if (migratedPreset && migratedPreset.config && migratedPreset.config.displayStyle) {
                if (legacyThemeMap[migratedPreset.config.displayStyle]) {
                    migratedPreset.config.displayStyle = legacyThemeMap[migratedPreset.config.displayStyle];
                }
            }
        }
    }

    if (!settings.personaData) {
        settings.personaData = {};
    }
    if (!settings.master_items) {
        settings.master_items = {};
    } else {
        // Cleanup hardcoded "New Item X" from Master Database
        for (const colId in settings.master_items) {
            const items = settings.master_items[colId];
            if (!items) continue;
            for (const itemName in items) {
                if (/^new item \d+$/i.test(itemName)) {
                    debugLog('Removing hardcoded item from Master DB:', itemName);
                    delete items[itemName];
                }
            }
        }
    }
    delete settings.profileHints;
    settings.version = currentVersion;
    debugLog('initSettings completed');
}
