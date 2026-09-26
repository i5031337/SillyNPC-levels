/**
 * Working out what an update would change, and which of those changes deserve a look.
 *
 * The reader proposes state; it does not get to impose it. Collections in particular are
 * replaced wholesale (applyCollectionUpdate empties the array and repopulates), so an item
 * the model simply forgets to mention is deleted. Additions and removals are therefore
 * surfaced rather than applied silently.
 *
 * Ordinary movement - HP dropping, a location changing - is left alone. Confirming every
 * one would mean answering a dialog on almost every message, and undo already covers a
 * mistake that slips through.
 */

import { splitValue } from './utils.js';
import { debugLog } from './constants.js';

export { splitValue };

const asNumber = (value) => {
    const match = String(value ?? '').match(/-?\d+(?:\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
};

/** The primary field of a collection, which identifies an item. */
export function primaryFieldName(colDef) {
    return (colDef?.fields || []).find(f => f.isPrimary)?.name || 'name';
}

export function itemKey(item, primary) {
    return String(item?.[primary] ?? item?.name ?? '').toLowerCase();
}

function itemLabel(item, primary) {
    return String(item?.[primary] ?? item?.name ?? '(unnamed)');
}

/**
 * Compares one stat before and after, emitting up to two changes: the value and,
 * separately, its ceiling. Keeping them apart matters because they carry different risk -
 * a value moving is ordinary, a ceiling moving is worth seeing.
 */
function diffStat({ scope, actor, label, before, after, policy, threshold }) {
    const changes = [];
    if (String(before ?? '') === String(after ?? '')) return changes;

    const from = splitValue(before);
    const to = splitValue(after);

    if (from.max !== to.max) {
        const fromMax = asNumber(from.max);
        const toMax = asNumber(to.max);
        const decreased = fromMax !== null && toMax !== null && toMax < fromMax;
        changes.push({
            scope, actor, label, kind: 'stat-max',
            before: from.max || '(none)', after: to.max || '(none)',
            // A ceiling going up is a level-up; going down is almost never intentional and
            // is what silently reset a character from 120 back to 80.
            risk: policy === 'review-all' || (policy === 'review-decreases' && decreased)
                ? 'risky' : 'informational',
            reason: decreased ? 'maximum decreased' : 'maximum increased',
        });
    }

    if (from.current !== to.current) {
        const fromNum = asNumber(from.current);
        const toNum = asNumber(to.current);
        const ceiling = asNumber(to.max) ?? asNumber(from.max);
        let risk = 'normal';
        let reason = '';

        if (fromNum !== null && toNum !== null && ceiling) {
            const swing = Math.abs(toNum - fromNum) / Math.abs(ceiling);
            if (swing > threshold) {
                risk = 'risky';
                reason = `changed by more than ${Math.round(threshold * 100)}% of its range`;
            }
        }
        changes.push({
            scope, actor, label, kind: 'stat',
            before: from.current, after: to.current, risk, reason,
        });
    }

    return changes;
}

/** Compares one actor's collections. */
function diffCollections({ scope, actor, before, after, trackerSettings, fromReplace }) {
    const changes = [];
    const ids = new Set([
        ...Object.keys(before?.collections || {}),
        ...Object.keys(after?.collections || {}),
    ]);

    for (const colId of ids) {
        const colDef = (trackerSettings.collections || []).find(c => c.id === colId);
        const primary = primaryFieldName(colDef);
        const beforeItems = before?.collections?.[colId] || [];
        const afterItems = after?.collections?.[colId] || [];

        const beforeByKey = new Map(beforeItems.map(i => [itemKey(i, primary), i]));
        const afterByKey = new Map(afterItems.map(i => [itemKey(i, primary), i]));

        for (const [key, item] of beforeByKey) {
            if (afterByKey.has(key)) continue;
            changes.push({
                scope, actor, label: itemLabel(item, primary), collectionId: colId,
                kind: 'item-remove', before: itemLabel(item, primary), after: '(gone)',
                risk: 'risky', reason: 'item would be removed',
                /* Where the removal came from, which decides whether the panel arrives
                   ticked. A per-message reply cannot delete by omission - applyCollectionUpdate
                   downgrades a bare list to additions - so an item missing from the "after"
                   state is one the reader explicitly asked to remove. A scan rebuilds the
                   whole list and means it, and there an item it forgot is indistinguishable
                   from one it dropped on purpose. Two different questions; they had one
                   answer, and it was the wrong one for the common case. */
                fromReplace: !!fromReplace,
                item,
            });
        }

        for (const [key, item] of afterByKey) {
            if (beforeByKey.has(key)) continue;
            changes.push({
                scope, actor, label: itemLabel(item, primary), collectionId: colId,
                kind: 'item-add', before: '(none)', after: itemLabel(item, primary),
                risk: 'risky', reason: 'new item',
                item,
            });
        }

        for (const [key, afterItem] of afterByKey) {
            const beforeItem = beforeByKey.get(key);
            if (!beforeItem) continue;
            for (const field of colDef?.fields || []) {
                const a = beforeItem?.[field.name];
                const b = afterItem?.[field.name];
                if (String(a ?? '') === String(b ?? '')) continue;
                changes.push({
                    scope, actor, label: `${itemLabel(afterItem, primary)} · ${field.label || field.name}`,
                    collectionId: colId, field: field.name,
                    kind: 'item-change', before: String(a ?? ''), after: String(b ?? ''),
                    risk: 'normal', reason: '',
                    item: afterItem,
                });
            }
        }
    }

    return changes;
}

/**
 * Whether a row arrives in the review panel already ticked.
 *
 * Everything does, except a removal that fell out of a rebuilt list. Every deletion used
 * to arrive unticked, from a time when any reply restating an inventory could produce a
 * phantom removal - and the effect was that a thing the story plainly used up stayed on
 * the sheet unless you noticed the one row that needed a click. A per-message reply can no
 * longer delete by omission (applyCollectionUpdate downgrades a bare list to additions),
 * so a removal from the reader is one it asked for by name. A scan rebuilds whole lists
 * and means it, and there an item it forgot really is indistinguishable from one it
 * dropped on purpose, so that one still asks.
 *
 * @param {object} change A row from computeStateDiff.
 * @returns {boolean}
 */
export function acceptedByDefault(change) {
    return change?.kind !== 'item-remove' || !change?.fromReplace;
}

/**
 * Everything an update would change.
 *
 * @param {object} before Current state.
 * @param {object} after State the update would produce (from applyUpdate dryRun).
 * @param {object} trackerSettings
 * @param {{ fromReplace?: boolean }} [how] fromReplace when the "after" state was built by
 *   rebuilding whole collections, as the history scan does - see diffCollections.
 * @returns {Array<object>} Flat list of changes, each with a `risk`.
 */
export function computeStateDiff(before, after, trackerSettings, { fromReplace = false } = {}) {
    const policy = trackerSettings.maxChangePolicy || 'free';
    const threshold = Number(trackerSettings.reviewSwingThreshold ?? 0.6);
    const changes = [];

    const globalKeys = new Set([
        ...Object.keys(before?.global || {}),
        ...Object.keys(after?.global || {}),
    ]);
    for (const key of globalKeys) {
        changes.push(...diffStat({
            scope: 'global', actor: null, label: key,
            before: before?.global?.[key], after: after?.global?.[key],
            policy, threshold,
        }));
    }

    const playerStart = changes.length;
    const playerStatKeys = new Set([
        ...Object.keys(before?.player?.stats || {}),
        ...Object.keys(after?.player?.stats || {}),
    ]);
    for (const key of playerStatKeys) {
        changes.push(...diffStat({
            scope: 'player', actor: null, label: key,
            before: before?.player?.stats?.[key], after: after?.player?.stats?.[key],
            policy, threshold,
        }));
    }
    // Rollover makes the XP numerator fall, but that is an earned level, not a loss.
    // Treat its paired Level change as one ordinary automatic event in risky mode.
    const beforePlayer = before?.player?.stats || {};
    const afterPlayer = after?.player?.stats || {};
    const xpKey = Object.keys(afterPlayer).find(key => key.toLowerCase() === 'xp');
    const levelKey = Object.keys(afterPlayer).find(key => key.toLowerCase() === 'level');
    if (xpKey && levelKey
        && Number(afterPlayer[levelKey]) > Number(beforePlayer[levelKey])
        && Number(splitValue(afterPlayer[xpKey]).current) < Number(splitValue(beforePlayer[xpKey]).current)) {
        for (const change of changes.slice(playerStart)) {
            if (change.scope === 'player' && change.kind === 'stat' && change.label === xpKey) {
                change.risk = 'normal';
                change.reason = 'XP carried forward after level-up';
            }
        }
    }
    changes.push(...diffCollections({
        scope: 'player', actor: null,
        before: before?.player, after: after?.player, trackerSettings, fromReplace,
    }));

    // Characters are matched by name; presence itself is decided elsewhere, so a
    // character appearing or leaving is not reported here as a change to review.
    const byName = (list) => new Map((list || []).map(c => [String(c.name).toLowerCase(), c]));
    const beforeChars = byName(before?.characters);
    const afterChars = byName(after?.characters);

    for (const [key, afterChar] of afterChars) {
        // A character the update introduces has everything to say and nothing to compare
        // against, so treat them as starting empty rather than skipping them. Skipping
        // meant a scan could learn an NPC's whole spell list and produce no rows at all,
        // which read as "nothing to change".
        const beforeChar = beforeChars.get(key) || { name: afterChar.name, stats: {}, collections: {} };
        const statKeys = new Set([
            ...Object.keys(beforeChar.stats || {}),
            ...Object.keys(afterChar.stats || {}),
        ]);
        for (const stat of statKeys) {
            changes.push(...diffStat({
                scope: 'character', actor: afterChar.name, label: stat,
                before: beforeChar.stats?.[stat], after: afterChar.stats?.[stat],
                policy, threshold,
            }));
        }
        changes.push(...diffCollections({
            scope: 'character', actor: afterChar.name,
            before: beforeChar, after: afterChar, trackerSettings, fromReplace,
        }));
    }

    return changes;
}

