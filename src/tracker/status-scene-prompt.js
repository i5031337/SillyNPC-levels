import { progressionFields } from './progression-fields.js';
import { collectionAppliesTo, collectionTargetLabel } from '../core/collection-targets.js';
import { promptText } from '../prompts/prompt-texts.js';
import { isReaderStat } from './stat-update-policy.js';
import { describeStatDefinitions } from './stat-prompt-definitions.js';
import { setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '../../../../../../script.js';
import { applyMacros } from '../prompts/macros.js';
import { getSettings } from '../core/settings.js';
import { DEFAULT_INLINE_RULES } from '../core/settings-tracker-defaults.js';
import { debugLog } from '../core/constants.js';

export function bind(deps) {
/**
 * Builds the system instruction for the AI
 */
// Exported for the tests: the prompt texts are checked to send exactly what they did.
function getStatusInstructions() {
    const settings = getSettings().statusTracker;
    const currentState = deps.committedState || deps.loadStateFromMetadata();

    const statDefinitions = describeStatDefinitions(settings);

    // Add field definitions for collections to guide the AI
    let schemas = '';
    if (settings.collections && settings.collections.length > 0) {
        // Filter collections to only those relevant to current actors
        const hasPlayer = !!currentState.player;
        const actors = currentState.characters || [];

        const relevantCollections = settings.collections.filter(col => {
            return (hasPlayer && collectionAppliesTo(col, 'player'))
                || actors.some(actor => collectionAppliesTo(col, 'npc', actor));
        });

        schemas = relevantCollections.map(col => {
            const fieldInfo = col.fields.map(f => `${f.name} (${f.type}${f.isMultiline ? ', multiline' : ''})`).join(', ');
            return `- ${col.id} (${col.name}) for ${collectionTargetLabel(col)}: ${fieldInfo}`;
        }).join('\n');
    }

    // One text, 'storyBlock' in prompt-texts.js, from the heading to the format line.
    return '\n' + promptText('storyBlock', {
        status: deps.formatCompactStatus(currentState, true),
        rules: applyMacros(DEFAULT_INLINE_RULES),
        statDefinitions,
        npcFields: deps.describeNpcStatFields(settings),
        schemas,
        xpProgression: progressionFields(settings, { isPlayer: true }).enabled
            || (settings.npcTemplates || []).some(template => template.progression?.enabled) ? 'on' : '',
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
    const playerProgression = progressionFields(settings, { isPlayer: true });
    const playerStat = first(settings.playerStats.filter(stat => isReaderStat(stat)
        && (!playerProgression.enabled || stat.name !== playerProgression.levelName)));
    if (playerProgression.enabled && playerStat === playerProgression.xpName) player.deltas = { [playerStat]: 1 };
    else if (playerStat) player.stats = { [playerStat]: '<new value>' };
    const sampleCollection = (target, verb) => {
        const col = (settings.collections || []).find(c => c?.id
            && (collectionAppliesTo(c, target, target === 'npc' ? state?.characters?.[0] || {} : undefined)));
        if (!col) return undefined;
        const primary = (col.fields || []).find(f => f.isPrimary)?.name || 'name';
        const item = { [primary]: '<item name>' };
        for (const field of col.fields || []) {
            if (field.name !== primary && field.type === 'number') item[field.name] = 1;
        }
        return { [col.id]: verb === 'add' ? { add: [item] } : { remove: ['<item lost>'] } };
    };
    const playerCollection = sampleCollection('player', 'add');
    if (playerCollection) player.collections = playerCollection;

    const character = { name: first(state?.characters) || '<someone present>' };
    const npcProgression = progressionFields(settings, { actor: state?.characters?.[0] });
    const npcStat = first(settings.npcStats.filter(stat => isReaderStat(stat)
        && (!npcProgression.enabled || stat.name !== npcProgression.levelName)));
    if (npcProgression.enabled && npcStat === npcProgression.xpName) character.deltas = { [npcStat]: 1 };
    else if (npcStat) character.stats = { [npcStat]: '<new value>' };
    const npcCollection = sampleCollection('npc', 'remove');
    if (npcCollection) character.collections = npcCollection;

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

    if (settings.extractionMode === 'extract' || settings.extractionMode === 'manual') {
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
    getStatusInstructions: { enumerable: true, configurable: true, get: () => getStatusInstructions },
    getStatusExample: { enumerable: true, configurable: true, get: () => getStatusExample },
    applyScenePrompt: { enumerable: true, configurable: true, get: () => applyScenePrompt },
    onGenerationStarted: { enumerable: true, configurable: true, get: () => onGenerationStarted },
    buildSceneContext: { enumerable: true, configurable: true, get: () => buildSceneContext },
});
}
