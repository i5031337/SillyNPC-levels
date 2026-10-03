import { splitValue } from '../core/utils.js';
import { debugLog } from '../core/constants.js';
import { primaryFieldName, itemKey } from './status-diff-compare.js';

/** Splits a diff into what may apply now and what needs a look. */
/** One key, however it was spelled: case folded, and a space read as the separator. */
const reasonKey = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, '.');

/**
 * The keys a change row could be named by.
 *
 * The bare label as well as the qualified one, because a reader that has only one Health
 * in front of it will often write "Health" and mean the character's.
 */
function reasonKeysFor(change) {
    const label = reasonKey(change?.label);
    if (!label) return [];
    const actor = change?.actor ? reasonKey(change.actor) : '';
    if (change?.scope === 'player') return [`player.${label}`, label];
    if (actor) return [`${actor}.${label}`, label];
    return [label];
}

/**
 * Puts the reader's own account of a change on the row it explains.
 *
 * Kept as `note`, separate from `reason`: that one is the extension's risk assessment -
 * "large swing", "maximum decreased" - and the reader's account of itself must not
 * overwrite the reason the row was held back in the first place.
 *
 * A qualified key is preferred over a bare one, so "Elza.Health" and "Health" arriving
 * together do not both land on Elza.
 *
 * @param {Array<object>} changes Mutated in place.
 * @param {Record<string, string>} why As returned by the reader.
 * @returns {string[]} The reasons that matched nothing, each with the key it arrived under,
 *   so they can be shown rather than silently dropped. The key is half the evidence: a
 *   reason that will not attach is usually filed under a name no row has, and without it
 *   the panel shows a list of sentences with nothing to say about where they belong.
 */
export function attachReasons(changes, why) {
    if (!why || typeof why !== 'object' || Array.isArray(why)) return [];

    const remaining = new Map();
    const asWritten = new Map();
    for (const [key, text] of Object.entries(why)) {
        const clause = String(text ?? '').trim();
        if (!clause) continue;
        remaining.set(reasonKey(key), clause);
        asWritten.set(reasonKey(key), String(key).trim());
    }

    // Qualified first, so a bare label cannot claim a row a fuller key was meant for.
    for (const pass of [0, 1]) {
        for (const change of changes || []) {
            if (change.note) continue;
            const keys = reasonKeysFor(change);
            const key = pass === 0 ? keys[0] : keys[1];
            if (!key || !remaining.has(key)) continue;
            change.note = remaining.get(key);
            remaining.delete(key);
        }
    }

    return [...remaining.entries()].map(([key, clause]) => `${asWritten.get(key) || key}: ${clause}`);
}

export function partitionChanges(changes, trackerSettings) {
    const unresolved = changes.filter(change => change.kind === 'npc-template' && !change.after);
    const resolved = changes.filter(change => !unresolved.includes(change));
    const mode = trackerSettings.reviewMode || 'risky';
    if (mode === 'off') return { auto: resolved, pending: unresolved };
    if (mode === 'all') return { auto: [], pending: changes };
    return {
        auto: changes.filter(c => c.risk !== 'risky'),
        pending: changes.filter(c => c.risk === 'risky'),
    };
}

/**
 * Rebuilds a minimal update object from a set of accepted changes.
 *
 * Feeding the result back through applyUpdate keeps every accepted row on the normal
 * validation path rather than writing to the state directly.
 *
 * @param {Array<object>} changes Accepted rows, each optionally carrying an edited `after`.
 * @param {object} currentState Needed to rebuild whole collections around a single item.
 * @param {object} trackerSettings
 */
export function buildUpdateFromChanges(changes, currentState, trackerSettings, cards = []) {
    const update = {};
    /** Collections are rebuilt in full and marked as a replacement when they are written. */
    const collectionWork = new Map();

    const actorOf = (change) => {
        if (change.scope === 'player') return currentState?.player;
        if (change.scope !== 'character') return null;

        const inScene = (currentState?.characters || [])
            .find(c => String(c.name).toLowerCase() === String(change.actor).toLowerCase());
        if (inScene) return inScene;

        /* Off stage. Their card is where their belongings live, and rebuilding a collection
           without it would replace everything they own with the single row being accepted.

           Both halves, which this used to take only one of. A card holds stats in
           statusOverrides and items in statusCollections, and api.js and character-fill.js
           both read the pair; taking only the collections left `stats` undefined, so
           accepting a maximum change for somebody who had left the scene joined the new
           ceiling to an empty current value and wrote "/120". */
        const card = (cards || [])
            .find(c => String(c.name || '').toLowerCase() === String(change.actor).toLowerCase());
        return card ? {
            name: card.name,
            stats: card.statusOverrides || {},
            collections: card.statusCollections || {},
        } : null;
    };

    for (const change of changes) {
        if (change.kind === 'npc-template') {
            if (!change.after) continue;
            update.characters ||= [];
            let entry = update.characters.find(actor => actor.name === change.actor);
            if (!entry) { entry = { name: change.actor }; update.characters.push(entry); }
            entry.npcTemplateId = change.after;
            continue;
        }
        if (change.kind === 'stat' || change.kind === 'stat-max') {
            // Re-join the halves so a max-only acceptance does not drop the current value.
            const live = change.scope === 'global'
                ? currentState?.global?.[change.label]
                : actorOf(change)?.stats?.[change.label];
            const parts = splitValue(live);

            /* A ceiling needs something to be the ceiling of. With no current value there
               is nothing to join it to, and joining anyway produced "/120" - which
               splitValue reads as a blank value with a maximum, so the number was simply
               gone. Supplying the card's stats fixed the common case; this closes the rest,
               where the actor genuinely has no reading for this stat yet. Skipped rather
               than invented: "120/120" would be the tracker deciding they are at full. */
            if (change.kind === 'stat-max' && !String(parts.current ?? '').trim()) {
                debugLog(`Skipped a maximum for ${change.actor || change.scope}.${change.label}: `
                    + 'there is no current value to apply it to.');
                continue;
            }

            const value = change.kind === 'stat'
                ? (parts.max ? `${change.after}/${parts.max}` : String(change.after))
                : (change.after && change.after !== '(none)' ? `${parts.current}/${change.after}` : parts.current);

            if (change.scope === 'global') {
                update.global ||= {};
                update.global[change.label] = value;
            } else if (change.scope === 'player') {
                update.player ||= {}; update.player.stats ||= {};
                update.player.stats[change.label] = value;
            } else {
                update.characters ||= [];
                let entry = update.characters.find(c => c.name === change.actor);
                if (!entry) { entry = { name: change.actor, stats: {} }; update.characters.push(entry); }
                entry.stats[change.label] = value;
            }
            continue;
        }

        // Item rows: gather per actor+collection, resolve once below.
        //
        // Keyed on the destination the row carries, not the one it was proposed with, so
        // moving a row from inventory to spells rebuilds spells and leaves inventory
        // alone - the old collection is never named, so it is never replaced.
        const mapKey = `${change.scope}|${change.actor || ''}|${change.collectionId}`;
        if (!collectionWork.has(mapKey)) collectionWork.set(mapKey, { change, rows: [] });
        collectionWork.get(mapKey).rows.push(change);
    }

    for (const [, { change: sample, rows }] of collectionWork) {
        const actor = actorOf(sample);
        const colDef = (trackerSettings.collections || []).find(c => c.id === sample.collectionId);
        const primary = primaryFieldName(colDef);
        const items = (actor?.collections?.[sample.collectionId] || []).map(i => ({ ...i }));

        for (const row of rows) {
            const key = itemKey(row.item, primary);
            const index = items.findIndex(i => itemKey(i, primary) === key);
            if (row.kind === 'item-add' && index === -1) items.push({ ...row.item });
            else if (row.kind === 'item-remove' && index !== -1) items.splice(index, 1);
            else if (row.kind === 'item-change' && index !== -1) items[index][row.field] = row.after;
        }

        // Marked as a replacement, not left as a bare list. A bare list is read as
        // additions - which is right for a model that ignored the delta format, and
        // exactly wrong here, where the rows have been reviewed and the list is the
        // answer, removals included.
        const rebuilt = { replace: items };

        if (sample.scope === 'player') {
            update.player ||= {}; update.player.collections ||= {};
            update.player.collections[sample.collectionId] = rebuilt;
        } else {
            update.characters ||= [];
            let entry = update.characters.find(c => c.name === sample.actor);
            if (!entry) { entry = { name: sample.actor }; update.characters.push(entry); }
            entry.collections ||= {};
            entry.collections[sample.collectionId] = rebuilt;
        }
    }

    return update;
}
