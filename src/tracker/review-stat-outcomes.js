import { splitValue } from '../core/utils.js';

/** A successful state save does not mean every stat survived validation. */
export function failedReviewedStats(rows, state, cards = [], grants = []) {
    return rows.filter(row => {
        if (row.grant || !['stat', 'stat-max'].includes(row.kind)) return false;
        if (!state) return true;
        const same = name => String(name || '').toLowerCase() === String(row.actor || '').toLowerCase();
        const actor = state.characters?.find(actor => same(actor.name));
        const stats = row.scope === 'global' ? state.global : row.scope === 'player' ? state.player?.stats
            : actor?.stats || cards.find(card => same(card.name))?.statusOverrides;
        const key = Object.keys(stats || {}).find(key => key.toLowerCase() === row.label.toLowerCase());
        if (key === undefined) return true;
        const parts = splitValue(stats[key]);
        const actual = row.kind === 'stat-max' ? parts.max : parts.current;
        // A reward can legitimately raise the same stat later in this review write.
        const growth = grants.findLast(grant => grant.scope === row.scope && same(grant.actor)
            && grant.label === row.label && grant.grant?.valueAfter !== undefined);
        const final = growth ? splitValue(growth.grant.valueAfter) : null;
        const expected = final ? row.kind === 'stat-max' ? final.max : final.current
            : row.kind === 'stat-max' && row.after === '(none)' ? '' : row.after;
        return String(actual ?? '').trim() !== String(expected ?? '').trim();
    });
}
