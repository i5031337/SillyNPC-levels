import { getSettings } from '../../core/settings.js';
import { splitValue } from '../../core/utils.js';

/** Replay old stat and item rows when a saved reply predates turn deltas. */
export function applyRows(state, rows) {
    const actorFor = row => row.scope === 'player' ? state.player
        : (state.characters || []).find(character =>
            String(character.name).toLowerCase() === String(row.actor).toLowerCase());
    for (const row of rows) {
        if (row.kind === 'stat' || row.kind === 'stat-max') {
            const stats = row.scope === 'global'
                ? (state.global ||= {}) : (actorFor(row)?.stats);
            if (!stats) continue;
            const { current, max } = splitValue(stats[row.label]);
            stats[row.label] = row.kind === 'stat'
                ? (max ? `${row.after}/${max}` : String(row.after))
                : (!row.after || row.after === '(none)' ? current : `${current}/${row.after}`);
            continue;
        }
        const actor = actorFor(row);
        if (!actor || !row.collectionId) continue;
        const items = (actor.collections ||= {})[row.collectionId] ||= [];
        const definition = (getSettings().statusTracker.collections || [])
            .find(collection => collection.id === row.collectionId);
        const primary = definition?.fields?.find(field => field.isPrimary)?.name || 'name';
        const keyOf = item => String(item?.[primary] ?? item?.name ?? '').toLowerCase();
        const wanted = row.item ? keyOf(row.item) : String(row.label).toLowerCase();
        const index = items.findIndex(item => keyOf(item) === wanted);
        if (row.kind === 'item-add' && index === -1 && row.item) items.push({ ...row.item });
        else if (row.kind === 'item-remove' && index !== -1) items.splice(index, 1);
        else if (row.kind === 'item-change' && index !== -1) items[index][row.field] = row.after;
    }
    return state;
}
