import { debugLog } from '../../core/constants.js';
import { loadStateFromMetadata, saveStateToMetadata } from '../status-logic.js';
import { goalFields, goalValue, setGoal } from '../goals.js';
import { validGoalProposal } from '../goal-proposals.js';

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
