import { quoteInMessage } from '../core/profile-update-policy.js';

/** Validate a reader goal change without mutating story state. */
export function validGoalProposal(field, current, proposal, messageText) {
    if (!field || !proposal || !quoteInMessage(proposal.quote, messageText)) return null;
    const action = String(proposal.action ?? '').trim();
    const text = String(proposal.text ?? '').trim();
    const before = String(current ?? '').trim();
    if (action === 'set' && !before && text) return { action, text, quote: proposal.quote.trim() };
    if (action === 'replace' && before && text && text !== before) {
        return { action, text, quote: proposal.quote.trim() };
    }
    if (action === 'complete' && before) return { action, text: '', quote: proposal.quote.trim() };
    return null;
}
