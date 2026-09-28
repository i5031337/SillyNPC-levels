import { 
    eventSource, 
    event_types, 
} from '../../../../../events.js';
import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from '../core/settings.js';
import { normaliseNpcPersistence, canTrackerSetNpcStat } from './stat-persistence.js';
import { getAllCharacters, getLibraryCharacters } from '../characters/character-repository.js';
import { LOG_PREFIX, debugLog, PROFILE_FIELDS, isStaticField } from '../core/constants.js';

export function bind(deps) {
function reconcileScenePresence(names, messageId, options = {}) {
    const settings = getSettings().statusTracker;
    if (settings.castMode !== 'speakers') return false;

    const state = structuredClone(deps.committedState || deps.loadStateFromMetadata());
    if (!state.presence || typeof state.presence !== 'object') {
        state.presence = { tick: 0, messageId: null, seen: [] };
    }
    const presence = state.presence;
    const key = String(messageId);

    // Collapse aliases before anything is matched or created, or the same character
    // arrives twice under two spellings and gets two rows with two sets of stats.
    // Anyone the reader has been told is not a character is dropped here rather than
    // admitted and removed again - both the decorator and the extractor arrive through
    // this function, which is what makes one decision cover both.
    const incoming = (names || []).map(n => deps.resolveCanonicalName(n)).filter(n => n && deps.mayJoinScene(n));

    // Repairs a chat that already has both spellings, as well as preventing new ones.
    let changed = deps.mergeDuplicateCharacters(state);

    // Signals recorded before aliases were resolved are still in alias form, and would
    // read as absent against the canonical cast.
    const normalisedSeen = [];
    for (const name of presence.seen || []) {
        const canonical = deps.resolveCanonicalName(name);
        if (!normalisedSeen.some(n => n.toLowerCase() === canonical.toLowerCase())) {
            normalisedSeen.push(canonical);
        }
    }
    if (normalisedSeen.join('|') !== (presence.seen || []).join('|')) changed = true;
    presence.seen = normalisedSeen;

    if (presence.messageId !== key) {
        // A new message: the clock advances and this message's signals start fresh.
        presence.tick = (Number(presence.tick) || 0) + 1;
        presence.messageId = key;
        presence.seen = [];
    }
    for (const name of incoming) {
        if (!presence.seen.some(n => n.toLowerCase() === name.toLowerCase())) presence.seen.push(name);
    }

    const seenLower = new Set(presence.seen.map(n => n.toLowerCase()));
    const grace = Math.max(0, Number(settings.castGraceMessages ?? 3));

    // Everyone observed is present now.
    for (const name of presence.seen) {
        const existing = state.characters.find(ch => ch.name.toLowerCase() === name.toLowerCase());
        if (existing) {
            if (existing.lastSeenTick !== presence.tick) { existing.lastSeenTick = presence.tick; changed = true; }
        } else {
            state.characters.push(buildCharacterState(name, state, settings));
            state.characters.at(-1).lastSeenTick = presence.tick;
            changed = true;
        }
    }

    // Anyone unseen for long enough leaves.
    const survivors = state.characters.filter(ch => {
        if (seenLower.has(ch.name.toLowerCase())) return true;
        // A complete cast list makes absence conclusive rather than merely unobserved.
        if (options.authoritative) return false;
        // Characters that predate presence tracking get this tick as their baseline
        // rather than being dropped immediately.
        if (ch.lastSeenTick === undefined) { ch.lastSeenTick = presence.tick; return true; }
        return (presence.tick - ch.lastSeenTick) < grace;
    });
    if (survivors.length !== state.characters.length) {
        debugLog('Scene presence: dropping',
            state.characters.filter(ch => !survivors.includes(ch)).map(ch => ch.name));
        state.characters = survivors;
        changed = true;
    }

    if (!changed) return false;

    state.timestamp = Date.now();
    // Not an undo step. Who is on stage is re-derived from the messages on every render,
    // so this fires several times a second while a chat loads - ten of them wiped the
    // entire undo ring in four seconds, and took the only copy of a story's stats with
    // it. Presence is not something anyone means to undo.
    deps.saveStateToMetadata(state, { label: 'Scene cast', recordHistory: false });
    eventSource.emit('sillynpc-status-updated', state);
    return true;
}

/**
 * Builds a fresh character state seeded from the NPC schema and any card overrides.
 * Shared by presence reconciliation and registerActiveCharacter.
 */
/**
 * Brings a character's card up to date while they are elsewhere.
 *
 * The scene cast and the record of what a character owns used to be the same list, so
 * the only way to update someone was to put them in the room. This writes to the card
 * instead: buildCharacterState reads it back the moment they next appear, so nothing is
 * lost and nobody is teleported into a scene they are not in.
 *
 * @param {object} card The character card from settings.
 * @param {object} updChar The character's portion of the update.
 * @param {object} state Current state, read for defaults only.
 * @param {object} settings Tracker settings.
 * @param {{dryRun?: boolean}} options
 */
function updateCardOffstage(card, updChar, state, settings,
    { dryRun = false, allowReplace = false, allowAdvancementChanges = false } = {}) {
    // A detached actor: built the same way the cast builds one, so it starts from what
    // the card already knows rather than from nothing.
    const actor = buildCharacterState(card.name, state, settings);

    /* Through the same two guards the scene's cast gets. Written raw, this path let a value
       no list allows onto a card - a Condition of "Unconscious" where the nine allowed words
       do not include it - and let a bare number lose the ceiling the card already had. Being
       off stage is about where somebody is, not about which rules their sheet follows. */
    const defOf = (name) => (settings.npcStats || [])
        .find(stat => String(stat?.name).toLowerCase() === String(name).toLowerCase());
    const validKeys = new Set((settings.npcStats || []).map(s => s.name.toLowerCase()));
    const sourceStats = updChar.stats || {};
    for (const [key, value] of Object.entries(sourceStats)) {
        const matched = deps.findMatchingStatKey(actor.stats, key) || key;
        if (!validKeys.has(matched.toLowerCase())) continue;
        if (!allowAdvancementChanges && !canTrackerSetNpcStat(defOf(matched))) continue;
        const merged = deps.mergeStatValue(actor.stats[matched], String(value));
        actor.stats[matched] = deps.constrainToDefinition(defOf(matched), merged, actor.stats[matched]);
    }

    const collectionIds = new Set((settings.collections || []).map(c => c.id.toLowerCase()));
    const collectionsToProcess = { ...(updChar.collections || {}) };
    for (const key of Object.keys(updChar)) {
        const lower = key.toLowerCase();
        if (collectionIds.has(lower) && lower !== 'stats' && lower !== 'collections' && lower !== 'name') {
            collectionsToProcess[key] = updChar[key];
        }
    }
    for (const colId of Object.keys(collectionsToProcess)) {
        deps.applyCollectionUpdate(actor, colId, collectionsToProcess[colId], { allowReplace });
    }

    if (dryRun) return actor;

    card.statusOverrides = { ...(card.statusOverrides || {}), ...actor.stats };
    if (Object.keys(collectionsToProcess).length) {
        card.statusCollections = structuredClone(actor.collections || {});
    }
    saveSettings();
    debugLog(`Updated ${card.name} on their card without adding them to the scene`);
    return actor;
}

function buildCharacterState(charName, state, trackerSettings) {
    const charData = { name: charName, stats: {}, collections: {} };
    if (trackerSettings.sceneBindingStat) {
        charData.boundTo = state.global[trackerSettings.sceneBindingStat] ?? '';
    }
    const matchedChar = getAllCharacters()
        .find(c => (c.name || '').toLowerCase() === charName.toLowerCase());

    (trackerSettings.npcStats || []).forEach(stat => {
        let value = stat.defaultValue || '';
        const override = matchedChar?.statusOverrides?.[stat.name];
        if (override !== undefined && String(override).trim() !== '') value = override;
        charData.stats[stat.name] = deps.getInitialStatValue(value, deps.resolveMaxValue(stat));
    });

    // What they were carrying and knew last time they were on stage.
    //
    // The scene cast is the only place a character's collections used to live, and
    // leaving the scene deleted the entry - so an NPC's spells and inventory survived
    // exactly as long as they were in the room. Their card keeps them now, the same way
    // it already keeps their stats.
    if (matchedChar?.statusCollections) {
        charData.collections = structuredClone(matchedChar.statusCollections);
    }
    return charData;
}

/**
 * Registers a character as active in the scene based on a matched setting character.
 */
function registerActiveCharacter(charName) {
    if (!charName) return;
    if (!deps.mayJoinScene(charName)) return false;

    const state = structuredClone(deps.committedState || deps.loadStateFromMetadata());
    const settings = getSettings();
    const trackerSettings = settings.statusTracker;
    
    const existingChar = state.characters.find(c => c.name.toLowerCase() === charName.toLowerCase());
    if (existingChar) return false; // Already registered

    const charData = { name: charName, stats: {}, collections: {} };
    if (trackerSettings.sceneBindingStat) {
        charData.boundTo = state.global[trackerSettings.sceneBindingStat] !== undefined ? state.global[trackerSettings.sceneBindingStat] : '';
    }
    
    const settingsChars = getAllCharacters();
    const matchedChar = settingsChars.find(c => c.name.toLowerCase() === charName.toLowerCase());

    trackerSettings.npcStats.forEach(s => {
        let value = s.defaultValue || '';
        if (matchedChar && matchedChar.statusOverrides && matchedChar.statusOverrides[s.name] !== undefined && String(matchedChar.statusOverrides[s.name]).trim() !== '') {
            value = matchedChar.statusOverrides[s.name];
        }
        charData.stats[s.name] = deps.getInitialStatValue(value, s.maxStatValue);
    });

    state.characters.push(charData);
    state.timestamp = Date.now();
    deps.saveStateToMetadata(state);
    return true; // Indicates state changed
}

/**
 * Removes an active character from the scene.
 */
function removeActiveCharacter(charName) {
    if (!charName) return;
    
    const state = JSON.parse(JSON.stringify(deps.committedState || deps.loadStateFromMetadata()));
    const initialLen = state.characters.length;
    
    state.characters = state.characters.filter(c => c.name.toLowerCase() !== charName.toLowerCase());
    
    if (state.characters.length !== initialLen) {
        state.timestamp = Date.now();
        deps.saveStateToMetadata(state);
        return true;
    }
    return false;
}

/**
 * Logic to handle collection updates (add, remove, update)
 * @param {ActorState} actor 
 * @param {string} collectionId 
 * @param {Object} update 
 */
/**
 * An item with every configured field present, defaulted and of the right type.
 *
 * This lived inside the full-replace branch only, so an item arriving through the
 * normal delta path - which is every item the per-message extractor adds - kept
 * whatever the model sent and never gained the fields it did not mention. A new item
 * therefore turned up holding little more than a name, with a quantity of "3" stored
 * as text beside another stored as a number.
 *
 * Fields the message did not state are filled from the schema default rather than
 * guessed: a blank is an honest record that the story never said so.
 *
 * @param {object} itemData Raw item from a reply, or from the master database.
 * @param {Array<object>} fields The collection's configured fields.
 * @returns {object}
 */
/**
 * One item, with every field the schema declares, typed and within its allowed values.
 *
 * `previous` is the item as it stands, when there is one. Without it a value already
 * stored off-list would be refused on every later write - narrowing a list in the builder
 * would then rewrite items nobody was editing, which is exactly what keeping the old value
 * is meant to prevent.
 */

Object.defineProperties(deps, {
    reconcileScenePresence: { enumerable: true, configurable: true, get: () => reconcileScenePresence },
    updateCardOffstage: { enumerable: true, configurable: true, get: () => updateCardOffstage },
    buildCharacterState: { enumerable: true, configurable: true, get: () => buildCharacterState },
    registerActiveCharacter: { enumerable: true, configurable: true, get: () => registerActiveCharacter },
    removeActiveCharacter: { enumerable: true, configurable: true, get: () => removeActiveCharacter },
});
}
