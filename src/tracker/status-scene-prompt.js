import { promptText } from '../prompts/prompt-texts.js';
import { 
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
    getThumbnailUrl,
    user_avatar,
    getRequestHeaders
} from '../../../../../../script.js';
import { applyMacros } from '../prompts/macros.js';
import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from '../core/settings.js';
import { LOG_PREFIX, debugLog, fieldsForCard, isStaticField } from '../core/constants.js';

export function bind(deps) {
function describeProfileInline(card) {
    return fieldsForCard(card)
        .map(field => {
            const value = String(card?.profile?.[field.id] ?? '').trim();
            return value ? `${field.label}: ${value}` : null;
        })
        .filter(Boolean)
        .join(' | ');
}

function describeCastProfiles(state) {
    const lines = [];

    if (state.player?.name) {
        // The player's profile lives on their persona record, not in the scene cast.
        const line = describeProfileInline(deps.getPlayerCard());
        if (line) lines.push(`${state.player.name} - ${line}`);
    }

    for (const actor of state.characters || []) {
        const line = describeProfileInline(deps.findCardForName(actor?.name));
        if (line) lines.push(`${actor.name} - ${line}`);
    }

    return lines.join('\n');
}

/**
 * Builds the system instruction for the AI
 */
// Exported for the tests: the prompt texts are checked to send exactly what they did.
function getStatusInstructions() {
    const settings = getSettings().statusTracker;
    const currentState = deps.committedState || deps.loadStateFromMetadata();

    /* The ceilings actually in play, not the configured ones.
     *
     * These were read straight off the settings, which contradicts the state this same
     * prompt has just shown: a player whose Health had grown to 160/180 was told "Health:
     * 160/180" and then "Player Max Stats: Health: 120", and a model resolves that by
     * trusting the limit. It reads the other way too, and that is the report this came
     * from - clear the ceiling on the sheet and the block went on announcing one.
     *
     * describeLimits in status-extractor.js makes the same reading for the reader model. */
    const describeMaxes = (list, valueFor) => (list || [])
        .map(stat => ({ stat, max: deps.promptCeiling(stat, valueFor(stat.name)) }))
        .filter(entry => entry.max)
        .map(entry => `${entry.stat.name}: ${entry.max}`)
        .join(', ');

    const playerStats = currentState.player?.stats || {};
    const playerMaxes = describeMaxes(settings.playerStats.filter(stat => stat.name.toLowerCase() !== 'xp'),
        name => playerStats[deps.findMatchingStatKey(playerStats, name) || name]);
    // One line for the whole cast, so the highest ceiling anyone present shows is the one
    // named: a party where one character has been raised to 350 must not be told 40.
    const npcMaxes = describeMaxes(settings.npcStats,
        name => deps.highestCeiling(currentState.characters, name));

    // Add field definitions for collections to guide the AI
    let schemas = '';
    if (settings.collections && settings.collections.length > 0) {
        // Filter collections to only those relevant to current actors
        const hasPlayer = !!currentState.player;
        const hasNPCs = currentState.characters && currentState.characters.length > 0;

        const relevantCollections = settings.collections.filter(col => {
            if (col.target === 'all') return true;
            if (col.target === 'player' && hasPlayer) return true;
            if (col.target === 'npc' && hasNPCs) return true;
            return false;
        });

        schemas = relevantCollections.map(col => {
            const fieldInfo = col.fields.map(f => `${f.name} (${f.type}${f.isMultiline ? ', multiline' : ''})`).join(', ');
            return `- ${col.id} (${col.name}): ${fieldInfo}`;
        }).join('\n');
    }

    // One text, 'storyBlock' in prompt-texts.js, from the heading to the format line.
    return '\n' + promptText('storyBlock', {
        status: deps.formatCompactStatus(currentState, true),
        rules: applyMacros(settings.systemRules),
        npcFields: deps.describeNpcStatFields(settings),
        limits: playerMaxes || npcMaxes ? 'on' : '',
        playerLimits: playerMaxes,
        npcLimits: npcMaxes,
        schemas,
        sceneChange: settings.sceneBindingStat ? 'on' : '',
        xpProgression: settings.playerStats.some(stat => stat.name?.toLowerCase() === 'xp' && !stat.locked)
            && settings.playerStats.some(stat => stat.name?.toLowerCase() === 'level') ? 'on' : '',
    }) + '\n';
}

/**
 * Builds a fake assistant response to prime the AI with the correct format
 */
// Exported for the tests, as getStatusInstructions is.
function getStatusExample() {
    /* Built from this setup's own stats and collections, with placeholders where values
     * would be. It used to be a goblin fight with "quantity" and "description" fields
     * written in, which taught every story model that status updates are about combat and
     * that items have fields many setups do not. */
    const settings = getSettings().statusTracker;
    const state = deps.committedState || deps.loadStateFromMetadata();
    const first = (list) => (list || []).map(s => s?.name).filter(Boolean)[0];

    const player = {};
    const playerStat = first(settings.playerStats);
    if (playerStat) player.stats = { [playerStat]: '<new value>' };
    const col = (settings.collections || []).find(c => c?.target !== 'npc');
    if (col) {
        const primary = (col.fields || []).find(f => f.isPrimary)?.name || 'name';
        const item = { [primary]: '<item name>' };
        for (const field of col.fields || []) {
            if (field.name !== primary && field.type === 'number') item[field.name] = 1;
        }
        player.collections = { [col.id]: { add: [item], remove: ['<something used up>'] } };
    }

    const character = { name: first(state?.characters) || '<someone present>' };
    const npcStat = first(settings.npcStats.filter(stat => stat.persistence !== 'innate'));
    if (npcStat) character.stats = { [npcStat]: '<new value>' };

    return promptText('storyExample', { update: JSON.stringify({ player, characters: [character] }) });
}

/**
 * Writes whichever prompts this mode uses, from the state as it stands right now.
 *
 * Called twice per turn, and the second call is the point. SillyTavern fires
 * WORLD_INFO_ACTIVATED while it assembles the prompt, and that is where we learn which
 * characters' lorebook entries fired - which is exactly who the scene block should be
 * describing, and is not known yet at GENERATION_STARTED.
 *
 * That it arrives in time was not obvious and is worth writing down: in Generate,
 * getWorldInfoPrompt is awaited at script.js:4576 and doChatInject - which reads these
 * IN_CHAT prompts - is called at 4686. A comment in index.js used to claim the opposite and
 * was wrong, which is why the narrator spent a long time being handed somebody's lore with
 * none of their numbers.
 *
 * Same key and depth both times, so the second write replaces the first rather than adding
 * to it.
 */
function applyScenePrompt() {
    const settings = getSettings().statusTracker;

    const clear = (key) => setExtensionPrompt(key, '', extension_prompt_types.IN_CHAT, 0, false);

    if (!settings.enabled) {
        clear('sillynpc-status-instructions');
        clear('sillynpc-status-example');
        clear('sillynpc-status-scene');
        return;
    }

    if (settings.extractionMode === 'extract') {
        // A separate pass does the bookkeeping, so the narrative prompt must not demand
        // a status block - that demand is what conflicts with character cards forbidding
        // numbers or status output in their prose.
        clear('sillynpc-status-instructions');
        clear('sillynpc-status-example');

        // It does still need to KNOW the state, or it invents HP and inventory. This is
        // plain fact, with no instruction to emit anything: a few hundred tokens against
        // the ~6,800 the instruction block used to cost.
        const scene = buildSceneContext();
        setExtensionPrompt(
            'sillynpc-status-scene',
            scene,
            extension_prompt_types.IN_CHAT,
            Number(settings.sceneInjectionDepth ?? 1),
            false,
            extension_prompt_roles.SYSTEM,
        );
        return;
    }

    clear('sillynpc-status-scene');

    setExtensionPrompt(
        'sillynpc-status-instructions',
        getStatusInstructions(),
        extension_prompt_types.IN_CHAT,
        0,
        false,
        extension_prompt_roles.USER,
    );

    setExtensionPrompt(
        'sillynpc-status-example',
        getStatusExample(),
        extension_prompt_types.IN_CHAT,
        1,
        false,
        extension_prompt_roles.ASSISTANT,
    );
}

function onGenerationStarted(type, data, dryRun) {
    if (dryRun) return;
    // A first pass, before any lorebook entry has fired. The WORLD_INFO_ACTIVATED handler
    // writes it again once it knows who did, and if nothing fires - SillyTavern does not
    // emit the event at all then - this is what stands.
    applyScenePrompt();
}

/**
 * The read-only scene block injected while extraction mode is on.
 *
 * Deliberately contains no schema, no example and no imperative - the narrative model is
 * being told what is true, not asked to maintain it.
 */
function buildSceneContext(given = null) {
    try {
        // The state is a parameter so this function can be tested at all, and that matters
        // more than it looks: the fault below was never in the renderer, which could always
        // produce full detail. It was in which argument this passed. A test that called the
        // renderer directly would have gone on passing throughout - and did, until it was
        // pointed here instead.
        const state = given || deps.committedState || deps.loadStateFromMetadata();
        if (!state) return '';
        /* Full detail, which this asked for and did not get for a long time.

           The parameter used to be called forPrompt, and both callers build prompts, so the
           name distinguished nothing and hid which of them was which. Inline mode passed
           true and was told what every item is; this passed false and got a list of names.
           So on the default setting the narrator saw "Spells: Snap-Ignite, Fire Aura" - no
           cost, no element, no description - and invented the rest every time one was cast.

           Nothing to do with the reader's own trimming: that lives in status-extractor.js
           behind a different function, and the two have never shared a renderer. The reader
           is sent less because it cannot change an item's description; the narrator needs it
           precisely because it is writing the scene. */
        const body = deps.formatCompactStatus(state, true);
        return body ? body.trim() : '';
    } catch (err) {
        debugLog('Could not build the scene context', err);
        return '';
    }
}

/**
 * Parses a message for status updates.
 */

Object.defineProperties(deps, {
    describeProfileInline: { enumerable: true, configurable: true, get: () => describeProfileInline },
    describeCastProfiles: { enumerable: true, configurable: true, get: () => describeCastProfiles },
    getStatusInstructions: { enumerable: true, configurable: true, get: () => getStatusInstructions },
    getStatusExample: { enumerable: true, configurable: true, get: () => getStatusExample },
    applyScenePrompt: { enumerable: true, configurable: true, get: () => applyScenePrompt },
    onGenerationStarted: { enumerable: true, configurable: true, get: () => onGenerationStarted },
    buildSceneContext: { enumerable: true, configurable: true, get: () => buildSceneContext },
});
}
