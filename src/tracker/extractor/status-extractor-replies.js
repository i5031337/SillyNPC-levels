import { promptText } from '../../prompts/prompt-texts.js';
import { getSettings } from '../../core/settings.js';
import { debugLog } from '../../core/constants.js';
import { loadStateFromMetadata, saveStateToMetadata } from '../status-logic.js';
import { splitValue } from '../../core/utils.js';
import { progressXp, boostStat } from '../progression.js';
import { configuredNumericMaximum } from '../numeric-stat-bounds.js';
import { requestExtraction, coerceToUpdate } from './status-extractor-request.js';
import { buildLevelBonusPrompt } from './status-extractor-prompt.js';
import { canAdvanceStat, isTurnStat } from '../stat-update-policy.js';
import { goalFields, goalValue, setGoal } from '../goals.js';
import { validGoalProposal } from '../goal-proposals.js';

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

    const eligibleDefs = (trackerSettings.playerStats || []).filter(def => {
        if (!canAdvanceStat(def)) return false;
        const parts = splitValue(current[def.name]);
        const max = configuredNumericMaximum(def);
        return Number.isFinite(Number(parts.current)) && parts.current !== ''
            && (isTurnStat(def) || max === null || Number(parts.current) < max);
    });
    const eligible = eligibleDefs.map(def => def.name);
    const prompt = buildLevelBonusPrompt(state, messageText, trackerSettings, leadUp, {
        level: transition.level,
        eligible: eligibleDefs.map(def => `${def.name}: ${isTurnStat(def)
            ? 'Turn; a pool bonus also raises its maximum'
            : `Advancement; fixed maximum ${configuredNumericMaximum(def) ?? 'not set'}`}`).join('; ') || '(none)',
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
    const raw = await requestExtraction(prompt, schema, trackerSettings,
        promptText('levelBonusSystem'), { usageKind: 'extraction' });
    const bonus = coerceToUpdate(raw);
    const description = String(bonus?.description ?? '').trim().slice(0, 180);
    if (!description) {
        const error = new Error('The level-up bonus reply could not be read. Retry this tracker reading.');
        error.output = raw;
        throw error;
    }
    const amount = Number(bonus?.amount);
    const target = eligible.find(name => name.toLowerCase() === String(bonus?.stat ?? '').toLowerCase());
    const sheetStats = parsed.player.stats || parsed.player;
    if (target && Number.isInteger(amount) && amount >= 1 && amount <= 5) {
        const def = trackerSettings.playerStats.find(stat => stat.name === target);
        const boosted = boostStat(current[target], sheetStats[target], amount, {
            growMaximum: isTurnStat(def),
            fixedMaximum: isTurnStat(def) ? null : configuredNumericMaximum(def),
        });
        if (boosted !== null) {
            sheetStats[target] = boosted;
            return { stat: target, description };
        }
    }
    sheetStats[bonusName] = `Level ${transition.level}: ${description}`;
    return { stat: null, bonusName };
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
