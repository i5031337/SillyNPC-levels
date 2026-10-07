import { npcStatsFor, proposedNpcTemplate } from '../core/npc-templates.js';
import { eventSource } from '../../../../../events.js';
import { getSettings, saveSettings } from '../core/settings.js';
import { getAllCharacters } from '../characters/character-repository.js';
import { LOG_PREFIX, debugLog } from '../core/constants.js';
import { progressXp } from './progression.js';
import { progressionFields } from './progression-fields.js';

export function bind(deps) {
    function warnClamped(warnings, owner, key, incoming, merged) {
        const wanted = String(incoming ?? '').split('/')[0].trim();
        const used = String(merged ?? '').split('/')[0].trim();
        if (wanted && Number.isFinite(Number(wanted)) && Number(wanted) !== Number(used)) {
            warnings?.push(`${owner} · ${key}: "${incoming}" adjusted: exceeds the pool maximum; using "${merged}".`);
        }
    }

    function warnSkippedActor(warnings, actor, reason, settings) {
        const metadata = new Set(['name', 'stats', 'collections', 'boundto', 'offstage', 'npcTemplateId', 'profile']);
        for (const key of Object.keys(actor.stats || actor)) {
            if (metadata.has(key) || settings.collections.some(col => col.id.toLowerCase() === key.toLowerCase())) continue;
            warnings?.push(`${actor.name || 'NPC'} · ${key}: skipped: ${reason}.`);
        }
    }

    function ageTombstones(state) {
        if (!state.recently_deleted) return;
        for (const colId in state.recently_deleted) {
            const items = state.recently_deleted[colId];
            for (const itemName in items) {
                if (--items[itemName] <= 0) delete items[itemName];
            }
            if (Object.keys(items).length === 0) delete state.recently_deleted[colId];
        }
    }

    function applyGlobalUpdate(state, update, settings, verbatim, warnings) {
        const validKeys = new Set(settings.globalStats.map(s => s.name.toLowerCase()));
        if (update.global) {
            Object.keys(update.global).forEach(updKey => {
                const actualKey = Object.keys(state.global).find(k => k.toLowerCase() === updKey.toLowerCase()) || updKey;
                if (validKeys.has(actualKey.toLowerCase())) {
                    const statDef = settings.globalStats.find(s => s.name.toLowerCase() === actualKey.toLowerCase());
                    const merged = deps.mergeStatValue(state.global[actualKey], update.global[updKey], { verbatim });
                    warnClamped(warnings, 'World', actualKey, update.global[updKey], merged);
                    state.global[actualKey] = deps.constrainToDefinition(statDef, merged, state.global[actualKey], warning => warnings?.push(`World · ${actualKey}: ${warning}`));
                } else warnings?.push(`World · ${updKey}: skipped: no configured stat matches this name.`);
            });
        }
    }

    // Collections can be nested or emitted as flattened top-level fields.
    function collectCollections(source, collectionIds, owner) {
        const collected = { ...(source.collections || {}) };
        Object.keys(source).forEach(key => {
            const lower = key.toLowerCase();
            if (collectionIds.has(lower) && lower !== 'stats' && lower !== 'collections' && lower !== 'name') {
                debugLog(`Found flattened collection "${key}" in ${owner}`);
                collected[key] = source[key];
            }
        });
        return collected;
    }

    function applyPlayerUpdate(state, player, settings, { verbatim, allowReplace, progressionResolved, dryRun, warnings }) {
        debugLog('Applying player update:', player);
        const validKeys = new Set(settings.playerStats.map(s => s.name.toLowerCase()));
        const collectionIds = new Set(settings.collections.map(c => c.id.toLowerCase()));
        const sourceStats = player.stats || player;

        // Group current/max fragments before applying either half.
        const groups = deps.groupIncomingStats(
            sourceStats,
            name => {
                const matched = deps.findMatchingStatKey(state.player.stats, name) || name;
                return validKeys.has(matched.toLowerCase()) ? matched : null;
            },
            key => validKeys.has(key.toLowerCase()),
            key => {
                const lower = key.toLowerCase();
                return lower === 'name' || lower === 'stats' || lower === 'collections'
                    || collectionIds.has(lower);
            },
            key => warnings?.push(`Player · ${key}: skipped: no configured stat matches this name.`),
        );

        const { xpName, levelName, enabled } = progressionFields(settings, { isPlayer: true });
        let xpProgress = null;
        if (enabled && !verbatim && !progressionResolved && groups.has(xpName)) {
            const group = groups.get(xpName);
            const raw = group.whole ?? group.current;
            if (raw !== undefined) {
                xpProgress = progressXp(state.player.stats[xpName], raw, state.player.stats[levelName]);
            }
        }

        for (const [actualKey, group] of groups) {
            if (xpProgress && (actualKey === xpName
                || (actualKey === levelName && xpProgress.levelsGained > 0))) continue;
            const statDef = settings.playerStats.find(s => s.name.toLowerCase() === actualKey.toLowerCase());
            const merged = deps.combineStatValue(state.player.stats[actualKey], group, statDef, { verbatim });
            warnClamped(warnings, 'Player', actualKey, group.current ?? group.whole, merged);
            state.player.stats[actualKey] = deps.constrainToDefinition(statDef, merged, state.player.stats[actualKey], warning => warnings?.push(`Player · ${actualKey}: ${warning}`));
        }
        if (xpProgress) {
            state.player.stats[xpName] = xpProgress.xp;
            if (xpProgress.levelsGained > 0) state.player.stats[levelName] = xpProgress.level;
        }

        const collections = collectCollections(player, collectionIds, 'player update');
        Object.keys(collections).forEach(id => {
            deps.applyCollectionUpdate(state.player, id, collections[id], { allowReplace, dryRun });
        });
        // A stats-only update cannot shrink the stored player's collections.
        return Object.keys(collections).length > 0;
    }

    function buildCharacterLookup(state) {
        const stateMap = new Map(
            state.characters
                .filter(c => c && typeof c.name === 'string')
                .map(c => [c.name.toLowerCase(), c]),
        );
        const settingsMap = new Map();
        const regexes = [];
        getAllCharacters().forEach(char => {
            if (char.name) settingsMap.set(char.name.toLowerCase(), char);
            if (char.aliases) {
                char.aliases.forEach(alias => {
                    if (alias.isRegex) {
                        try { regexes.push({ regex: new RegExp(alias.pattern, 'i'), char }); } catch { /* skip invalid regex */ }
                    } else if (alias.pattern) {
                        settingsMap.set(alias.pattern.toLowerCase(), char);
                    }
                });
            }
        });
        return { stateMap, settingsMap, regexes };
    }

    function applyCharacterStats(charData, updChar, matchedChar, settings, validKeys, collectionIds,
        { verbatim, progressionResolved, dryRun, warnings, skipProgression = false }) {
        const sourceStats = updChar.stats || updChar;
        const groups = deps.groupIncomingStats(
            sourceStats,
            name => {
                const matched = deps.findMatchingStatKey(charData.stats, name) || name;
                return validKeys.has(matched.toLowerCase()) ? matched : null;
            },
            key => validKeys.has(key.toLowerCase()),
            key => {
                const lower = key.toLowerCase();
                return lower === 'name' || lower === 'stats' || lower === 'boundto'
                    || lower === 'collections' || lower === 'npctemplateid' || lower === 'offstage'
                    || lower === 'profile' || collectionIds.has(lower);
            },
            key => warnings?.push(`${updChar.name} · ${key}: skipped: no configured stat matches this name.`),
        );
        const { xpName, levelName, enabled } = progressionFields(settings, { actor: charData });
        const xpGroup = groups.get(xpName);
        const xpProgress = enabled && !verbatim && !progressionResolved && !skipProgression && xpGroup
            ? progressXp(charData.stats[xpName], xpGroup.whole ?? xpGroup.current, charData.stats[levelName]) : null;
        if (xpProgress) {
            groups.set(xpName, { whole: xpProgress.xp });
            if (xpProgress.levelsGained > 0) groups.set(levelName, { whole: xpProgress.level });
        }
        let cardChanged = false;
        for (const [canonicalKey, group] of groups) {
            const statDef = settings.npcStats.find(s => s.name.toLowerCase() === canonicalKey.toLowerCase());
            const merged = deps.combineStatValue(charData.stats[canonicalKey], group, statDef, { verbatim });
            warnClamped(warnings, updChar.name, canonicalKey, group.current ?? group.whole, merged);
            charData.stats[canonicalKey] = deps.constrainToDefinition(statDef, merged, charData.stats[canonicalKey], warning => warnings?.push(`${updChar.name} · ${canonicalKey}: ${warning}`));

            // Cards live in settings, outside the cloned state. A dry run cannot touch them.
            if (matchedChar && !dryRun) {
                if (!matchedChar.statusOverrides) matchedChar.statusOverrides = {};
                matchedChar.statusOverrides[canonicalKey] = charData.stats[canonicalKey];
                cardChanged = true;
            }
        }
        return cardChanged;
    }

    function applyCharacterUpdate(state, updChar, context) {
        const { settings, lookup, validKeys, collectionIds,
            admitCharacters, dryRun, allowReplace, progressionResolved, verbatim, offstageSkipped, warnings } = context;
        if (!updChar.name) {
            warnSkippedActor(warnings, updChar, 'the NPC name is missing', settings);
            return false;
        }
        const canonicalName = deps.resolveCanonicalName(updChar.name);
        if (!deps.mayJoinScene(canonicalName)
            || (state.player?.name && [updChar.name, canonicalName]
                .some(name => String(name).trim().toLowerCase() === String(state.player.name).trim().toLowerCase()))) {
            warnSkippedActor(warnings, updChar, 'this character is excluded from the NPC scene', settings);
            return false;
        }
        const lowerName = canonicalName.toLowerCase();
        debugLog(`Applying update for character: ${updChar.name}`, updChar);
        let charData = lookup.stateMap.get(lowerName);
        const matchedChar = lookup.settingsMap.get(lowerName)
            || lookup.regexes.find(r => r.regex.test(updChar.name))?.char;

        if (!charData && !admitCharacters) {
            warnSkippedActor(warnings, updChar, 'the NPC is not present in the scene', settings);
            debugLog('Ignoring character not present in the message:', updChar.name);
            return false;
        }
        if (!charData && admitCharacters) {
            if (!matchedChar) {
                offstageSkipped.push(updChar.name);
                warnSkippedActor(warnings, updChar, 'the NPC is offstage and has no saved card', settings);
                return false;
            }
            const detached = deps.updateCardOffstage(matchedChar, updChar, state, settings,
                { dryRun, allowReplace, progressionResolved, verbatim, warnings });
            // The review diff needs a row; the real card update leaves the cast untouched.
            if (dryRun && detached) state.characters.push(detached);
            return false;
        }
        if (!charData) {
            charData = deps.buildCharacterState(canonicalName, state, settings);
            state.characters.push(charData);
            lookup.stateMap.set(lowerName, charData);
        }
        const selected = proposedNpcTemplate(charData.npcTemplateId ? charData : matchedChar || charData, updChar);
        let assigned = false;
        if (selected && charData.npcTemplateId !== selected.id) {
            charData.npcTemplateId = selected.id;
            state.npcTemplateAssignments ||= {};
            state.npcTemplateAssignments[charData.id || lowerName] = selected.id;
            assigned = true;
            if (matchedChar && !dryRun) matchedChar.npcTemplateId = selected.id;
        }
        const actorSettings = { ...settings, npcStats: npcStatsFor(charData, settings) };
        if (assigned) for (const stat of actorSettings.npcStats) {
            if (charData.stats[stat.name] === undefined) {
                charData.stats[stat.name] = deps.getInitialStatValue(stat.defaultValue, stat.maxStatValue, stat);
            }
        }
        const actorKeys = new Set(actorSettings.npcStats.map(stat => stat.name.toLowerCase()));
        let cardChanged = applyCharacterStats(charData, updChar, matchedChar, actorSettings, actorKeys,
            collectionIds, { verbatim, progressionResolved, dryRun, warnings, skipProgression: assigned });
        cardChanged ||= assigned && !!matchedChar && !dryRun;
        const collections = collectCollections(updChar, collectionIds, `character update for ${updChar.name}`);
        Object.keys(collections).forEach(id => {
            deps.applyCollectionUpdate(charData, id, collections[id], { allowReplace, dryRun });
        });
        if (matchedChar && !dryRun && Object.keys(collections).length) {
            matchedChar.statusCollections = structuredClone(charData.collections || {});
            cardChanged = true;
        }
        return cardChanged;
    }

    function applyCharacters(state, characters, settings, options) {
        const lookup = buildCharacterLookup(state);
        const validKeys = new Set(settings.npcStats.map(s => s.name.toLowerCase()));
        const collectionIds = new Set(settings.collections.map(c => c.id.toLowerCase()));
        const context = { ...options, settings, lookup, validKeys, collectionIds };
        let cardChanged = false;
        characters.forEach(char => {
            if (applyCharacterUpdate(state, char, context)) cardChanged = true;
        });
        if (cardChanged) saveSettings();
    }

    function applyUpdate(update, options = {}) {
        const { dryRun = false, label = 'AI update', admitCharacters = false, allowReplace = false,
            partOfMessage = false, verbatim = false, progressionResolved = false, warnings } = options;
        // Card writes occur before the state save, so reject a missing chat before either.
        if (!dryRun && !deps.hasOpenChat()) {
            console.warn(LOG_PREFIX, 'Refused to apply a tracker update with no chat open.');
            return null;
        }

        const offstageSkipped = [];
        const state = structuredClone(deps.committedState || deps.loadStateFromMetadata());
        ageTombstones(state);
        const settings = getSettings().statusTracker;
        applyGlobalUpdate(state, update, settings, verbatim, warnings);

        if (update.player) applyPlayerUpdate(state, update.player, settings, { verbatim, allowReplace, progressionResolved, dryRun, warnings });
        if (update.characters && Array.isArray(update.characters)) {
            applyCharacters(state, update.characters, settings, {
                admitCharacters, dryRun, allowReplace, progressionResolved,
                verbatim, offstageSkipped, warnings,
            });
        }

        state.timestamp = Date.now();
        if (offstageSkipped.length) {
            Object.defineProperty(state, 'offstageSkipped', {
                value: offstageSkipped, enumerable: false, configurable: true,
            });
        }
        if (dryRun) return state;
        deps.saveStateToMetadata(state, { label, partOfMessage });
        eventSource.emit('sillynpc-status-updated', state);
        return state;
    }

    Object.defineProperties(deps, {
        applyCharacterStats: { enumerable: true, configurable: true, get: () => applyCharacterStats },
        applyUpdate: { enumerable: true, configurable: true, get: () => applyUpdate },
    });
}
