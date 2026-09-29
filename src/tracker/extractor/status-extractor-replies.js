import { promptText } from '../../prompts/prompt-texts.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { getContext } from '../../../../../../st-context.js';
import { isChatCharacter } from '../../characters/character-repository.js';
import { LOG_PREFIX, debugLog } from '../../core/constants.js';
import { profileFieldsForCard as fieldsForCard } from '../../core/profile-fields.js';
import { appendMemory } from '../../core/profile-memories.js';
import { replaceableProfileValue, sourcedMemory } from '../../core/profile-update-policy.js';
import { getPlayerCard, findCardForName, loadStateFromMetadata, saveStateToMetadata } from '../status-logic.js';
import { splitValue } from '../../core/utils.js';
import { progressXp, boostStat } from '../progression.js';
import { requestExtraction, coerceToUpdate } from './status-extractor-request.js';
import { syncProfileToLore } from '../../lore/lore-sync.js';
import { buildLevelBonusPrompt } from './status-extractor-prompt.js';
import { canAdvanceStat } from '../stat-update-policy.js';
import { goalFields, goalValue, setGoal } from '../goals.js';
import { validGoalProposal } from '../goal-proposals.js';
import { readNpcMemories, writeNpcMemories } from '../npc-memories.js';

/** Choose a story-appropriate sheet bonus once an XP award crosses its cap. */
export async function addLevelBonus(parsed, state, trackerSettings, messageText, leadUp = []) {
    const stats = parsed?.player?.stats || parsed?.player;
    const current = state?.player?.stats || {};
    const xpName = Object.keys(current).find(key => key.toLowerCase() === 'xp');
    const levelName = Object.keys(current).find(key => key.toLowerCase() === 'level');
    const bonusName = (trackerSettings.playerStats || []).find(s => s.name.toLowerCase() === 'level bonus' && !s.locked)?.name;
    if (!stats || !xpName || !levelName || !bonusName) return;
    const xpKey = Object.keys(stats).find(key => key.toLowerCase() === 'xp');
    if (!xpKey) return;
    const transition = progressXp(current[xpName], stats[xpKey], current[levelName]);
    if (!transition || transition.levelsGained < 1) return;

    const eligible = (trackerSettings.playerStats || []).filter(def => {
        if (!canAdvanceStat(def)) return false;
        const parts = splitValue(current[def.name]);
        return Number.isFinite(Number(parts.current)) && parts.current !== '';
    }).map(def => def.name);
    const prompt = buildLevelBonusPrompt(state, messageText, trackerSettings, leadUp, {
        level: transition.level,
        eligible: eligible.join(', ') || '(none)',
        pendingChanges: parsed,
    });
    const schema = {
        type: 'object', required: ['description'],
        properties: {
            description: { type: 'string' },
            stat: { type: 'string' },
            amount: { type: 'number' },
        },
    };
    let bonus;
    try {
        bonus = coerceToUpdate(await requestExtraction(prompt, schema, trackerSettings,
            promptText('levelBonusSystem'),
            { usageKind: 'extraction' }));
    } catch (error) {
        console.warn(LOG_PREFIX, 'Level-up bonus request failed:', error);
    }
    const description = String(bonus?.description ?? '').trim().slice(0, 180);
    if (!description) return null;
    const amount = Number(bonus?.amount);
    const target = eligible.find(name => name.toLowerCase() === String(bonus?.stat ?? '').toLowerCase());
    const sheetStats = parsed.player.stats || parsed.player;
    if (target && Number.isInteger(amount) && amount >= 1 && amount <= 5) {
        const boosted = boostStat(current[target], sheetStats[target], amount);
        if (boosted !== null) sheetStats[target] = boosted;
    }
    sheetStats[bonusName] = `Level ${transition.level}: ${description}`;
    return { stat: target && Number.isInteger(amount) && amount >= 1 && amount <= 5 ? target : null,
        bonusName };
}

export function applyProfileFromReply(parsed, messageId = null, messageText = '') {
    const changed = [];
    const touched = new Set();
    const settings = getSettings();
    const limit = settings.statusTracker?.presets?.[settings.activeSystem]?.definition?.memories?.maxEntriesPerCharacter;
    const state = loadStateFromMetadata();
    let memoriesChanged = false;
    const memoryLore = new Map();

    const write = (card, incoming, isPlayer = false) => {
        if (!card || !incoming || typeof incoming !== 'object') return;
        if (!card.profile || typeof card.profile !== 'object') card.profile = {};

        for (const field of fieldsForCard(card)) {
            if (field.policy !== 'replaceable') continue;
            const quote = incoming.profileEvidence?.[field.id]
                ?? parsed?.why?.[`${card.name}.${field.id}`];
            const value = replaceableProfileValue(field, incoming.profile?.[field.id], quote, messageText);
            // An omitted field means "unchanged", and a blank one is the model failing to
            // answer rather than deciding somebody has no personality.
            if (!value || value === String(card.profile[field.id] ?? '').trim()) continue;
            card.profile[field.id] = value;
            changed.push(`${card.name}.${field.label}`);
            touched.add(card);
        }
        const memoryFields = new Map(fieldsForCard(card).map(f => [f.id, f]));
        for (const proposed of Array.isArray(incoming.memories) ? incoming.memories : []) {
            const candidate = sourcedMemory(memoryFields.get(proposed?.fieldId), proposed, messageId, messageText);
            if (!candidate) continue;
            const actor = isPlayer ? state.player : null;
            if (isPlayer && !actor) continue;
            const source = isPlayer ? actor.memories : readNpcMemories(state, card);
            const { store, added } = appendMemory(source, candidate, limit);
            if (!added) continue;
            if (isPlayer) actor.memories = store;
            else writeNpcMemories(state, card, store);
            memoriesChanged = true;
            memoryLore.set(card, store);
            changed.push(`${card.name}.${proposed.fieldId}`);
        }
    };

    if (parsed?.player?.profile || parsed?.player?.memories) {
        try { write(getPlayerCard(), parsed.player, true); } catch { /* no persona */ }
    }

    for (const incoming of Array.isArray(parsed?.characters) ? parsed.characters : []) {
        if (incoming?.profile || incoming?.memories) write(findCardForName(incoming.name), incoming);
    }

    if (memoriesChanged) saveStateToMetadata(state, { label: 'Memories', recordHistory: false });
    if (changed.length) {
        if (touched.size) saveSettings();
        if ([...touched].some(card => card?.id && isChatCharacter(card.id))) {
            getContext()?.saveMetadataDebounced?.();
        }
        for (const card of new Set([...touched, ...memoryLore.keys()])) syncProfileToLore(card, memoryLore.get(card)).catch(err =>
            console.error(LOG_PREFIX, 'Could not update profile in lorebook', err));
        debugLog('Profile fields the story changed:', changed);
    }
    return changed;
}

/** Apply only configured, evidenced goal changes in this turn. */
export function applyGoalsFromReply(parsed, messageId, messageText) {
    if (messageId == null) return [];
    const state = loadStateFromMetadata();
    const changed = [];
    const apply = (actor, scope, proposed, label) => {
        if (!actor || !proposed || typeof proposed !== 'object') return;
        for (const field of goalFields(scope)) {
            const valid = validGoalProposal(field, goalValue(actor, field.id), proposed[field.id], messageText);
            if (!valid) continue;
            if (setGoal(actor, field.id, valid.text, {
                messageId, quote: valid.quote, action: valid.action,
            })) changed.push(`${label}.${field.label}`);
        }
    };
    apply(state.player, 'player', parsed?.player?.goals, state.player?.name || 'Player');
    for (const proposal of Array.isArray(parsed?.characters) ? parsed.characters : []) {
        const actor = (state.characters || []).find(item =>
            String(item.name).toLocaleLowerCase() === String(proposal?.name).toLocaleLowerCase());
        apply(actor, 'npc', proposal?.goals, actor?.name || proposal?.name);
    }
    if (changed.length) {
        saveStateToMetadata(state, { label: 'Goals', recordHistory: false });
        debugLog('Goals the story changed:', changed);
    }
    return changed;
}
