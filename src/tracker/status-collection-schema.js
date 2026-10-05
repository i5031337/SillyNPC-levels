import { getSettings, saveSettings } from '../core/settings.js';
import { getLibraryCharacters } from '../characters/character-repository.js';
import { debugLog, isStaticField } from '../core/constants.js';

export function bind(deps) {
function syncOverrideToActiveState(charName, statName, newValue) {
    if (!charName || !statName) return false;
    
    // Attempt to load current state; if we don't have one, we can't sync.
    const state = deps.loadStateFromMetadata();
    if (!state) return false;
    
    const existingChar = state.characters.find(c => c.name.toLowerCase() === charName.toLowerCase());
    if (existingChar) {
        if (newValue === '') {
            const settings = getSettings().statusTracker;
            const statDef = settings.npcStats.find(s => s.name === statName);
            existingChar.stats[statName] = statDef ? (statDef.defaultValue || '') : '';
        } else {
            existingChar.stats[statName] = newValue;
        }
        
        state.timestamp = Date.now();
        deps.saveStateToMetadata(state);
        return true;
    }
    
    return false;
}

/**
 * Merges an AI-provided item with its Master Database entry if it exists.
 * If not, adds the item to the Master Database.
 */
function getMergedItem(collectionId, aiItem, { dryRun = false } = {}) {
    const settings = getSettings();
    const colDef = settings.statusTracker.collections.find(c => c.id === collectionId);
    if (!colDef) return aiItem;

    const primaryField = colDef.fields.find(f => f.isPrimary) || { name: 'name' };
    const itemName = aiItem[primaryField.name] || aiItem.name;
    if (!itemName) return aiItem;

    const masterDb = settings.master_items || {};
    
    const lowerName = String(itemName).toLowerCase();
    const masterEntry = masterDb[collectionId]?.[lowerName];

    if (masterEntry) {
        const mergedItem = { ...aiItem };
        colDef.fields.forEach(field => {
            // Static fields come from Master DB if available
            if (isStaticField(field) && masterEntry[field.name] !== undefined) {
                mergedItem[field.name] = masterEntry[field.name];
            }
        });
        return mergedItem;
    } else {
        // Not found, add to master
        if (!dryRun) updateMasterItem(collectionId, itemName, aiItem);
        return aiItem;
    }
}

/**
 * Updates a single item in the Master Database.
 * Only saves fields marked as static.
 */
function updateMasterItem(collectionId, itemName, itemData) {
    const settings = getSettings();
    if (!settings.master_items) settings.master_items = {};
    if (!settings.master_items[collectionId]) settings.master_items[collectionId] = {};

    const colDef = settings.statusTracker.collections.find(c => c.id === collectionId);
    if (!colDef) return;

    const staticData = {};
    colDef.fields.forEach(field => {
        if (isStaticField(field) && itemData[field.name] !== undefined) {
            staticData[field.name] = itemData[field.name];
        }
    });

    const lowerName = String(itemName).toLowerCase();
    settings.master_items[collectionId][lowerName] = staticData;
    saveSettings();
}

/**
 * Handles renaming an item in the Master Database.
 */
function renameMasterItem(collectionId, oldName, newName, itemData) {
    const settings = getSettings();
    if (!settings.master_items || !settings.master_items[collectionId]) return;

    const oldLower = String(oldName).toLowerCase();
    const newLower = String(newName).toLowerCase();

    if (settings.master_items[collectionId][oldLower]) {
        delete settings.master_items[collectionId][oldLower];
    }
    
    updateMasterItem(collectionId, newName, itemData);
}

/**
 * Removes an item from the Master Database.
 */
function deleteMasterItem(collectionId, itemName) {
    const settings = getSettings();
    if (!settings.master_items || !settings.master_items[collectionId]) return;

    const lowerName = String(itemName).toLowerCase();
    if (settings.master_items[collectionId][lowerName]) {
        debugLog(`Deleting master item: ${itemName} from ${collectionId}`);
        delete settings.master_items[collectionId][lowerName];
        saveSettings();
    }
}

/**
 * Moves every stored item from one collection id to another.
 *
 * Chat state (actor.collections[id]) and the Master Database
 * (settings.master_items[id]) are both keyed by the collection id, so renaming a
 * collection without this leaves all of its items stranded under the old key.
 *
 * @param {string} oldId
 * @param {string} newId
 * @returns {number} How many stores held items under the old id, so the caller can say
 *   what was carried across rather than leaving the user to check.
 */
function renameCollectionId(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return 0;

    let moved = 0;
    const settings = getSettings();

    // Master Database
    const master = settings.master_items;
    if (master && master[oldId]) {
        master[newId] = { ...(master[newId] || {}), ...master[oldId] };
        moved += Object.keys(master[oldId]).length;
        delete master[oldId];
    }

    // Persona master storage (all personas, not just the active one)
    for (const persona of Object.values(settings.personaData || {})) {
        const cols = persona?.collections;
        if (cols && cols[oldId] !== undefined) {
            moved += (cols[oldId] || []).length;
            cols[newId] = cols[oldId];
            delete cols[oldId];
        }
    }

    // Character cards. Missing from this list until now, which was the worst of the
    // omissions: a card is what a character walks back into a scene carrying, so a rename
    // left everyone off stage to return empty-handed - and the items were still in the
    // settings file under the old key, invisible and unreachable.
    for (const card of getLibraryCharacters()) {
        const cols = card?.statusCollections;
        if (cols && cols[oldId] !== undefined) {
            moved += (cols[oldId] || []).length;
            cols[newId] = cols[oldId];
            delete cols[oldId];
        }
    }

    // Live chat state
    const state = deps.committedState || deps.loadStateFromMetadata();
    if (state) {
        const actors = [state.player, ...(state.characters || [])].filter(Boolean);
        for (const actor of actors) {
            if (actor.collections && actor.collections[oldId] !== undefined) {
                moved += (actor.collections[oldId] || []).length;
                actor.collections[newId] = actor.collections[oldId];
                delete actor.collections[oldId];
            }
        }
        if (state.recently_deleted && state.recently_deleted[oldId] !== undefined) {
            state.recently_deleted[newId] = state.recently_deleted[oldId];
            delete state.recently_deleted[oldId];
        }
        deps.saveStateToMetadata(state);
    }

    saveSettings();
    return moved;
}

/** Which stores a stat list's values live in, and which rule scope points at it. */

Object.defineProperties(deps, {
    syncOverrideToActiveState: { enumerable: true, configurable: true, get: () => syncOverrideToActiveState },
    getMergedItem: { enumerable: true, configurable: true, get: () => getMergedItem },
    updateMasterItem: { enumerable: true, configurable: true, get: () => updateMasterItem },
    renameMasterItem: { enumerable: true, configurable: true, get: () => renameMasterItem },
    deleteMasterItem: { enumerable: true, configurable: true, get: () => deleteMasterItem },
    renameCollectionId: { enumerable: true, configurable: true, get: () => renameCollectionId },
});
}
