import { collectionAppliesTo } from '../core/collection-targets.js';
import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from '../core/settings.js';
import { LOG_PREFIX, debugLog, PROFILE_FIELDS, isStaticField } from '../core/constants.js';

export function bind(deps) {
function normaliseItem(itemData, fields, previous = null) {
    const out = {};
    for (const fieldDef of fields || []) {
        let val = deps.constrainToDefinition(fieldDef, itemData?.[fieldDef.name], previous?.[fieldDef.name]);

        if (val === undefined || val === null) {
            val = fieldDef.defaultValue !== undefined && fieldDef.defaultValue !== ''
                ? fieldDef.defaultValue
                : (fieldDef.type === 'number' ? 0 : (fieldDef.type === 'boolean' ? false : ''));
        }

        if (fieldDef.type === 'number') {
            out[fieldDef.name] = parseFloat(deps.constrainToDefinition(fieldDef, parseFloat(val) || 0, previous?.[fieldDef.name])) || 0;
        } else if (fieldDef.type === 'boolean') {
            out[fieldDef.name] = (val === true || val === 'true');
        } else {
            out[fieldDef.name] = String(val);
        }
    }
    return out;
}
function applyCollectionUpdate(actor, collectionId, update, { allowReplace = false } = {}) {
    const settings = getSettings().statusTracker;
    const colDef = settings.collections.find(c => c.id.toLowerCase() === collectionId.toLowerCase());
    
    // Validate collection exists
    if (!colDef) {
        console.warn(LOG_PREFIX, `Attempted to update non-existent collection: ${collectionId}`);
        return;
    }

    const actualCollectionId = colDef.id;

    // Validate target
    const isPlayer = actor.name === deps.getCurrentPersonaName(); // Simple check for player
    if (!collectionAppliesTo(colDef, isPlayer ? 'player' : 'npc', actor)) {
        debugLog(`Blocked collection update: ${collectionId} does not apply to ${actor.name}.`);
        return;
    }

    if (!actor.collections) actor.collections = {};
    
    // A bare array used to mean "this is everything" whatever asked for it, so a reply
    // that listed items instead of reporting changes emptied the collection and rebuilt
    // it from that list - deleting everything the reply happened not to restate. The
    // system prompt asks for {add, remove} and says omission is not removal; a small
    // model disobeys anyway, and the code has to survive that.
    //
    // Replacement is still right for the history scan, which reads the whole story to
    // produce a corrected list and puts it through the review panel. It is never right
    // for a single message, so the caller has to say so.
    // An explicit replacement: code that rebuilt the list itself and means it. Said in
    // the data rather than through an option on the call, because the flag had to be
    // remembered by every caller of buildUpdateFromChanges and three of the four forgot -
    // so an accepted removal was read as a list of additions and the item never left.
    if (update && !Array.isArray(update) && Array.isArray(update.replace)) {
        return applyCollectionUpdate(actor, collectionId, update.replace, { allowReplace: true });
    }

    if (Array.isArray(update) && !allowReplace) {
        debugLog(`Collection "${actualCollectionId}" arrived as a list; treating it as additions.`);
        return applyCollectionUpdate(actor, collectionId, { add: update }, { allowReplace });
    }
    // Handle Full State Sync (Array)
    if (Array.isArray(update)) {
        actor.collections[actualCollectionId] = [];
        const validFields = colDef.fields;
        const primaryField = validFields.find(f => f.isPrimary) || { name: 'name' };

        update.forEach(itemData => {
            if (!itemData || typeof itemData !== 'object') return;
            
            const itemName = itemData[primaryField.name] || itemData.name;
            if (!String(itemName ?? '').trim()) return;

            // Skip if recently deleted (tombstone)
            const lowerName = String(itemName).toLowerCase();
            const state = deps.committedState || deps.loadStateFromMetadata();
            if (state && state.recently_deleted && state.recently_deleted[actualCollectionId] && state.recently_deleted[actualCollectionId][lowerName]) {
                debugLog(`Skipping tombstoned item: ${itemName} in ${actualCollectionId}`);
                return;
            }

            // Master Database Merge Logic
            const masterItem = deps.getMergedItem(actualCollectionId, itemData);

            actor.collections[actualCollectionId].push(normaliseItem(masterItem, validFields));
        });
        return;
    }

    if (!actor.collections[actualCollectionId]) actor.collections[actualCollectionId] = [];
    
    // Handle Delta Update (Object)
    /* "clear" is a replacement like any other, and is gated like one.
     *
     * It was not, which made it the one way past the care taken directly above: a bare list
     * is downgraded to additions unless the caller says otherwise, precisely because a small
     * model restating an inventory would otherwise delete everything it did not mention.
     * `clear` skipped all of that and emptied the collection outright. Nothing in the
     * extension sends it and no shipped prompt mentions it, so it was unreachable by design
     * and fully reachable by accident - a model emitting a plausible "clear": true.
     *
     * Kept rather than deleted because the history scan does legitimately rebuild a list,
     * and allowReplace is exactly the flag that says so. */
    if (update.clear === true) {
        if (!allowReplace) {
            debugLog(`Ignored "clear" on "${actualCollectionId}": a single message may not empty a collection.`);
            return;
        }
        actor.collections[actualCollectionId] = [];
        return;
    }

    // Handle "add"
    if (Array.isArray(update.add)) {
            for (const itemData of update.add) {
                const primaryField = colDef.fields.find(f => f.isPrimary) || { name: 'name' };
                const itemName = itemData[primaryField.name] || itemData.name;
                const lowerName = String(itemName).toLowerCase();
                const state = deps.committedState || deps.loadStateFromMetadata();
                
                if (state?.recently_deleted?.[actualCollectionId]?.[lowerName]) {
                    debugLog(`Skipping AI-added tombstoned item: ${itemName} in ${actualCollectionId}`);
                    continue;
                }
                addItem(actor, actualCollectionId, itemData);
            }
    }

    // Handle "remove"
    if (Array.isArray(update.remove)) {
        for (const itemName of update.remove) removeItem(actor, actualCollectionId, itemName);
    }

    // Handle "update"
    if (Array.isArray(update.update)) {
        const primary = colDef.fields.find(field => field.isPrimary)?.name || 'name';
        for (const upd of update.update) {
            const itemName = upd[primary] ?? upd.name;
            if (itemName !== undefined && itemName !== null) updateItem(actor, actualCollectionId, itemName, upd);
        }
    }
}

/**
 * Adds an item to an actor's collection.
 */
function addItem(actor, collectionId, itemData) {
    if (!actor.collections) actor.collections = {};
    if (!actor.collections[collectionId]) actor.collections[collectionId] = [];
    
    const settings = getSettings().statusTracker;
    const colDef = settings.collections.find(c => c.id === collectionId);
    if (!colDef) return;

    const primaryField = colDef.fields.find(f => f.isPrimary) || { name: 'name' };
    const itemName = itemData[primaryField.name] !== undefined ? itemData[primaryField.name] : itemData.name;
    if (itemName === undefined || itemName === null) return;

    // Clear from recently_deleted if it was there
    const lowerName = String(itemName).toLowerCase();
    const state = deps.committedState || deps.loadStateFromMetadata();
    if (state && state.recently_deleted && state.recently_deleted[collectionId]) {
        if (state.recently_deleted[collectionId][lowerName]) {
            delete state.recently_deleted[collectionId][lowerName];
        }
    }

    const validFields = new Set(colDef.fields.map(f => f.name));

    // Filter fields to only allowed ones
    const filteredItem = { [primaryField.name]: itemName };
    Object.keys(itemData).forEach(key => {
        if (validFields.has(key)) {
            filteredItem[key] = itemData[key];
        }
    });

    // Find if item with same primary field value exists (case-insensitive)
    const existingIndex = actor.collections[collectionId].findIndex(i => String(i[primaryField.name]).toLowerCase() === String(itemName).toLowerCase());
    
    if (existingIndex !== -1) {
        const existing = actor.collections[collectionId][existingIndex];
        // Merge fields
        const merged = { ...existing, ...filteredItem };
        
        // Handle quantity merging if a numeric quantity field exists
        const qtyField = colDef.fields.find(f => f.type === 'number' && (f.name === 'quantity' || f.name === 'qty' || f.name === 'count'));
        if (qtyField) {
            const fieldName = qtyField.name;
            if (existing[fieldName] !== undefined && filteredItem[fieldName] !== undefined) {
                const q1 = parseFloat(existing[fieldName]) || 0;
                const q2 = parseFloat(filteredItem[fieldName]) || 0;
                // The same number that is already held is the model restating the state,
                // not the character acquiring a second lot. Summing it doubled the
                // quantity on every message that mentioned the item, compounding in
                // silence - and asked the review panel to confirm the same doubling over
                // and over.
                //
                // The two cannot be told apart from the delta alone, so this picks the
                // safer error: finding exactly two more rope while already holding two is
                // missed, which the story shows and a person can correct. The other way
                // round grows without bound and reads as the tracker inventing loot.
                //
                // Judged on the quantity alone rather than on the whole item: an add that
                // corrects some other field - a note, a description - is a real update,
                // and the quantity coming along with it unchanged must not be doubled for
                // having been mentioned.
                if (q1 !== q2) merged[fieldName] = q1 + q2;
            }
        }

        // Normalised like any other item: the merge could otherwise leave a quantity the
        // model sent as text sitting beside one already stored as a number.
        actor.collections[collectionId][existingIndex] = normaliseItem(merged, colDef.fields, existing);
    } else {
        // This branch filled in defaults but never enforced types, so an item added
        // through the delta path - which is every item the per-message extractor adds -
        // kept "4" as a string where the replace path would have stored 4.
        actor.collections[collectionId].push(normaliseItem(filteredItem, colDef.fields));
    }
}

/**
 * Removes an item from an actor's collection by name.
 */
function removeItem(actor, collectionId, itemName, isManual = false) {
    if (!actor.collections || !actor.collections[collectionId] || !itemName) return;
    
    const settings = getSettings().statusTracker;
    const colDef = settings.collections.find(c => c.id === collectionId);
    const primaryField = colDef ? colDef.fields.find(f => f.isPrimary) : { name: 'name' };
    const primaryFieldName = primaryField ? primaryField.name : 'name';

    const lowerName = String(itemName).toLowerCase();
    actor.collections[collectionId] = actor.collections[collectionId].filter(i => String(i[primaryFieldName]).toLowerCase() !== lowerName);

    if (isManual) {
        const state = deps.committedState || deps.loadStateFromMetadata();
        if (state && state.recently_deleted) {
            if (!state.recently_deleted[collectionId]) state.recently_deleted[collectionId] = {};
            state.recently_deleted[collectionId][lowerName] = 3; // TTL 3 messages
        }
    }
}

/**
 * Updates an item in an actor's collection.
 */
function updateItem(actor, collectionId, itemName, updates) {
    if (!actor.collections || !actor.collections[collectionId] || !itemName) return;
    
    const settings = getSettings().statusTracker;
    const colDef = settings.collections.find(c => c.id === collectionId);
    if (!colDef) return;

    const primaryField = colDef.fields.find(f => f.isPrimary) || { name: 'name' };
    const primaryFieldName = primaryField.name;
    const validFields = new Set(colDef.fields.map(f => f.name));

    const lowerName = String(itemName).toLowerCase();
    const itemIndex = actor.collections[collectionId].findIndex(i => String(i[primaryFieldName]).toLowerCase() === lowerName);
    
    if (itemIndex !== -1) {
        const item = actor.collections[collectionId][itemIndex];

        const merged = { ...item };
        Object.keys(updates).forEach(key => {
            if (validFields.has(key)) merged[key] = updates[key];
        });

        /* Normalised like the add and replace paths, which this used to skip: writing
           straight through meant the field-name check was the only guard, so an update row
           could store "seven" in a number field and a value outside a configured options
           list. Both are reachable from an ordinary per-message reply.

           `item` as the previous value for the same reason addItem passes it: a value
           already stored off-list must not be refused on every later write. */
        actor.collections[collectionId][itemIndex] = normaliseItem(merged, colDef.fields, item);
    }
}

/**
 * Synchronizes a manual override change immediately into the active chat metadata state.
 */

Object.defineProperties(deps, {
    applyCollectionUpdate: { enumerable: true, configurable: true, get: () => applyCollectionUpdate },
    addItem: { enumerable: true, configurable: true, get: () => addItem },
    removeItem: { enumerable: true, configurable: true, get: () => removeItem },
});
}
