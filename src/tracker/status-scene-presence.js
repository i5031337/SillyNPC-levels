import { npcStatsFor, npcTemplateFor, proposedNpcTemplate } from '../core/npc-templates.js';
import { eventSource } from '../../../../../events.js';
import { getSettings, saveSettings } from '../core/settings.js';
import { getAllCharacters } from '../characters/character-repository.js';
import { debugLog } from '../core/constants.js';

export function bind(deps) {
function reconcileScenePresence(names, messageId, options = {}) {
    const settings = getSettings().statusTracker;
    const state = structuredClone(deps.committedState || deps.loadStateFromMetadata());
    if (!state.presence || typeof state.presence !== 'object') {
        state.presence = { tick: 0, messageId: null, seen: [] };
    }
    const presence = state.presence;
    const key = String(messageId);
    let changed = deps.mergeDuplicateCharacters(state);

    if (presence.messageId !== key) {
        // A new message gets a fresh cast decision and advances the grace clock.
        presence.tick = (Number(presence.tick) || 0) + 1;
        presence.messageId = key;
        presence.seen = [];
        presence.suppressed = [];
        presence.authoritative = false;
        changed = true;
    }
    const suppressed = new Set((presence.suppressed || [])
        .map(name => deps.resolveCanonicalName(name).toLowerCase()));

    // Collapse aliases before anything is matched or created, or the same character
    // arrives twice under two spellings and gets two rows with two sets of stats.
    // Anyone the reader has been told is not a character is dropped here rather than
    // admitted and removed again - both the decorator and the extractor arrive through
    // this function, which is what makes one decision cover both.
    const incoming = (names || []).map(n => deps.resolveCanonicalName(n))
        .filter(n => n && !suppressed.has(n.toLowerCase())
            && deps.mayJoinScene(n, { speaker: !options.authoritative }));

    // Signals recorded before aliases were resolved are still in alias form, and would
    // read as absent against the canonical cast.
    const normalisedSeen = [];
    for (const name of presence.seen || []) {
        const canonical = deps.resolveCanonicalName(name);
        if (suppressed.has(canonical.toLowerCase())) continue;
        if (!normalisedSeen.some(n => n.toLowerCase() === canonical.toLowerCase())) {
            normalisedSeen.push(canonical);
        }
    }
    if (normalisedSeen.join('|') !== (presence.seen || []).join('|')) changed = true;
    presence.seen = normalisedSeen;

    if (options.authoritative) {
        // The reader's cast is complete for this message. A later portrait redraw
        // must not add a guessed speaker back to it.
        presence.seen = [];
        presence.authoritative = true;
        changed = true;
    }
    if (!presence.authoritative || options.authoritative) {
        for (const name of incoming) {
            if (!presence.seen.some(n => n.toLowerCase() === name.toLowerCase())) presence.seen.push(name);
        }
    }

    const seenLower = new Set(presence.seen.map(n => n.toLowerCase()));
    const grace = 3;

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
        if (presence.authoritative) return false;
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

/** Update an offstage card without changing scene presence; dry runs return a detached actor. */
function updateCardOffstage(card, updChar, state, settings,
    { dryRun = false, allowReplace = false, allowAdvancementChanges = false, verbatim = false } = {}) {
    // A detached actor: built the same way the cast builds one, so it starts from what
    // the card already knows rather than from nothing.
    const actor = buildCharacterState(card.name, state, settings);
    const selected = proposedNpcTemplate(card, updChar);
    if (selected) actor.npcTemplateId = selected.id;
    const statDefs = npcStatsFor(actor, settings);
    for (const stat of statDefs) if (actor.stats[stat.name] === undefined) {
        actor.stats[stat.name] = deps.getInitialStatValue(stat.defaultValue, stat.maxStatValue, stat);
    }

    const collectionIdsForStats = new Set((settings.collections || []).map(c => c.id.toLowerCase()));
    deps.applyCharacterStats(actor, updChar, null, { ...settings, npcStats: statDefs },
        new Set(statDefs.map(stat => stat.name.toLowerCase())), collectionIdsForStats,
        { dryRun: true, allowAdvancementChanges, verbatim, skipProgression: selected?.id !== card.npcTemplateId });

    const collectionIds = new Set((settings.collections || []).map(c => c.id.toLowerCase()));
    const collectionsToProcess = { ...(updChar.collections || {}) };
    for (const key of Object.keys(updChar)) {
        const lower = key.toLowerCase();
        if (collectionIds.has(lower) && lower !== 'stats' && lower !== 'collections' && lower !== 'name') {
            collectionsToProcess[key] = updChar[key];
        }
    }
    for (const colId of Object.keys(collectionsToProcess)) {
        deps.applyCollectionUpdate(actor, colId, collectionsToProcess[colId], { allowReplace, dryRun });
    }

    if (dryRun) return actor;

    if (selected) {
        card.npcTemplateId = selected.id;
        state.npcTemplateAssignments ||= {};
        state.npcTemplateAssignments[card.id || card.name.toLowerCase()] = selected.id;
    }
    card.statusOverrides = { ...(card.statusOverrides || {}), ...actor.stats };
    if (Object.keys(collectionsToProcess).length) {
        card.statusCollections = structuredClone(actor.collections || {});
    }
    saveSettings();
    debugLog(`Updated ${card.name} on their card without adding them to the scene`);
    return actor;
}

/**
 * Builds a fresh character state seeded from the NPC schema and any card overrides.
 * Shared by presence reconciliation and registerActiveCharacter.
 */
function buildCharacterState(charName, state, trackerSettings) {
    const charData = { name: charName, npcTemplateId: '', stats: {}, collections: {} };
    const matchedChar = getAllCharacters()
        .find(c => (c.name || '').toLowerCase() === charName.toLowerCase());
    if (matchedChar?.id) charData.id = matchedChar.id;
    const remembered = state.npcTemplateAssignments?.[matchedChar?.id || charName.toLowerCase()];
    const selected = npcTemplateFor(remembered ? { npcTemplateId: remembered } : matchedChar);
    if (selected) charData.npcTemplateId = selected.id;
    npcStatsFor(charData, trackerSettings).forEach(stat => {
        let value = stat.defaultValue || '';
        const override = matchedChar?.statusOverrides?.[stat.name];
        if (override !== undefined && String(override).trim() !== '') value = override;
        charData.stats[stat.name] = deps.getInitialStatValue(value, deps.resolveMaxValue(stat), stat);
    });

    // Restore the collections held on the card while this NPC was offstage.
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

    const charData = buildCharacterState(charName, state, trackerSettings);

    state.characters.push(charData);
    if (state.presence?.suppressed) {
        state.presence.suppressed = state.presence.suppressed
            .filter(name => name.toLowerCase() !== charName.toLowerCase());
    }
    // A manual addition must survive redraws of the reader's complete cast for this
    // message. On the next message it follows the same presence rules as everyone else.
    if (state.presence?.authoritative && state.presence.messageId !== null) {
        if (!state.presence.seen.some(name => name.toLowerCase() === charName.toLowerCase())) {
            state.presence.seen.push(charName);
        }
        charData.lastSeenTick = state.presence.tick;
    }
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
        if (state.presence?.messageId !== undefined && state.presence.messageId !== null) {
            const lower = deps.resolveCanonicalName(charName).toLowerCase();
            state.presence.seen = (state.presence.seen || [])
                .filter(name => deps.resolveCanonicalName(name).toLowerCase() !== lower);
            if (!Array.isArray(state.presence.suppressed)) state.presence.suppressed = [];
            if (!state.presence.suppressed.some(name => name.toLowerCase() === lower)) {
                state.presence.suppressed.push(charName);
            }
        }
        state.timestamp = Date.now();
        deps.saveStateToMetadata(state);
        return true;
    }
    return false;
}

Object.defineProperties(deps, {
    reconcileScenePresence: { enumerable: true, configurable: true, get: () => reconcileScenePresence },
    updateCardOffstage: { enumerable: true, configurable: true, get: () => updateCardOffstage },
    buildCharacterState: { enumerable: true, configurable: true, get: () => buildCharacterState },
    registerActiveCharacter: { enumerable: true, configurable: true, get: () => registerActiveCharacter },
    removeActiveCharacter: { enumerable: true, configurable: true, get: () => removeActiveCharacter },
});
}
