import { resolveProgressionConfig, progressionStatEligible, progressionFieldId } from '../core/progression-config.js';
import { boostStat } from './progression.js';
import { configuredNumericMaximum } from './numeric-stat-bounds.js';
import { collectionRewardAppliesTo, validateRewardEntry } from '../core/collection-rewards.js';

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const transitionId = row => row.transition?.id || row.transition?.transitionId;
const primaryOf = collection => collection?.fields?.find(field => field.isPrimary)?.name || 'name';
const keyOf = (item, primary) => String(item?.[primary] ?? item?.name ?? '').trim().toLowerCase();

/** XP and Level form one reviewed transition. Grants always remain optional. */
export function prepareGrantReview(auto, pending, transitions = []) {
    for (const transition of transitions) {
        const belongs = row => row.scope === transition.scope && same(row.actor, transition.actor)
            && ['stat', 'stat-max'].includes(row.kind) && [transition.xpName, transition.levelName].includes(row.label);
        const provenance = Object.fromEntries(['id', 'transitionId', 'scope', 'actor', 'actorId', 'templateId',
            'oldLevel', 'newLevel', 'xpName', 'levelName', 'xpBefore', 'xpAfter']
            .filter(key => transition[key] !== undefined).map(key => [key, transition[key]]));
        for (const row of [...auto, ...pending]) if (belongs(row)) row.transition = provenance;
        if (pending.some(belongs)) {
            for (let index = auto.length - 1; index >= 0; index--) {
                if (belongs(auto[index])) pending.push(...auto.splice(index, 1));
            }
        }
    }
    for (let index = auto.length - 1; index >= 0; index--) {
        if (auto[index].grant) pending.push(...auto.splice(index, 1));
    }
    return { auto, pending };
}

/** Only rows actually pending can be accepted; provenance cannot be edited. */
export function selectReviewRows(pending, accepted, appliedRows = []) {
    const appliedIds = new Set(appliedRows.map(row => row.grant?.id).filter(Boolean));
    const rows = [];
    const selectedOriginals = new Set();
    for (const incoming of accepted || []) {
        const original = pending.find(row => incoming.grant?.id ? row.grant?.id === incoming.grant.id
            : row.kind === incoming.kind && row.scope === incoming.scope && same(row.actor, incoming.actor)
                && row.label === incoming.label && row.collectionId === incoming.collectionId && row.field === incoming.field);
        if (!original || (original.grant && appliedIds.has(original.grant.id))) continue;
        if (selectedOriginals.has(original)) continue;
        selectedOriginals.add(original);
        rows.push(original.grant || original.transition ? original : { ...original, ...incoming });
    }
    const rejectedTransitions = new Set();
    for (const row of pending) {
        const id = transitionId(row);
        if (id && !rows.includes(row)) rejectedTransitions.add(id);
    }
    return {
        rows: rows.filter(row => !rejectedTransitions.has(transitionId(row))
            && !rejectedTransitions.has(row.grant?.transitionId)),
        rejectedTransitions,
    };
}

export function reviewActor(row, state, cards = []) {
    if (row.scope === 'player') return state.player;
    if (row.scope !== 'character') return null;
    const card = cards.find(actor => same(actor.name, row.actor));
    const actor = state.characters?.find(actor => same(actor.name, row.actor));
    return actor ? { ...card, ...actor } : card ? { ...card, stats: card.statusOverrides || {}, collections: card.statusCollections || {} } : null;
}

/** A held transition must still describe the same starting sheet and owner. */
export function validateReviewedTransitions(rows, state, settings, cards = [], personaId) {
    const invalid = new Set();
    for (const row of rows) {
        const provenance = row.transition;
        if (!provenance) continue;
        const actor = reviewActor(row, state, cards);
        const config = resolveProgressionConfig(settings, { isPlayer: row.scope === 'player', templateId: actor?.npcTemplateId });
        const definitions = (row.scope === 'player' ? settings.playerStats || [] : settings.npcStats || [])
            .map(field => ({ ...field, id: progressionFieldId(field) }));
        const xp = definitions.find(field => field.id === config.xpFieldId)?.name;
        const level = definitions.find(field => field.id === config.levelFieldId)?.name;
        const identity = row.scope === 'player' ? `player:${personaId || actor?.id || 'player'}`
            : `npc:${actor?.id || String(actor?.name || '').toLowerCase()}`;
        if (!actor || !config.enabled || provenance.actorId !== identity
            || xp !== provenance.xpName || level !== provenance.levelName
            || (provenance.templateId && actor.npcTemplateId !== provenance.templateId)
            || Number(actor.stats?.[level]) !== Number(provenance.oldLevel)
            || String(actor.stats?.[xp]) !== String(provenance.xpBefore)) invalid.add(transitionId(row));
    }
    return { rows: rows.filter(row => !invalid.has(transitionId(row)) && !invalid.has(row.grant?.transitionId)), invalid };
}

/** Resolve gains from live state after ordinary accepted rows have been applied. */
export function materializeGrantRows(rows, state, settings, cards = [], { appliedRows = [], acceptedTransitionIds = [], personaId } = {}) {
    const result = [], rejected = [];
    const appliedIds = new Set(appliedRows.map(row => row.grant?.id).filter(Boolean));
    const transitions = new Set([...acceptedTransitionIds, ...appliedRows.map(transitionId).filter(Boolean)]);
    const working = structuredClone(state);
    const workingCards = structuredClone(cards);
    for (const row of rows) {
        if (!row.grant) { result.push(row); continue; }
        const grant = row.grant;
        const actor = reviewActor(row, working, workingCards);
        const config = resolveProgressionConfig(settings, { isPlayer: row.scope === 'player', templateId: actor?.npcTemplateId });
        const definitions = (row.scope === 'player' ? settings.playerStats || [] : settings.npcStats || [])
            .map(field => ({ ...field, id: progressionFieldId(field) }));
        const xp = definitions.find(field => field.id === config.xpFieldId)?.name;
        const level = definitions.find(field => field.id === config.levelFieldId)?.name;
        const identity = row.scope === 'player' ? `player:${personaId || actor?.id || 'player'}` : `npc:${actor?.id || String(actor?.name || '').toLowerCase()}`;
        const identityOkay = grant.actorId === identity;
        if (!actor || !grant.id || !identityOkay || !config.enabled || appliedIds.has(grant.id)
            || !transitions.has(grant.transitionId) || xp !== grant.xpName || level !== grant.levelName
            || (grant.templateId && actor.npcTemplateId !== grant.templateId)
            || Number(actor.stats?.[level]) !== Number(grant.newLevel)) {
            rejected.push(row); continue;
        }
        if (row.kind === 'stat') {
            const definition = definitions.find(field => field.name === row.label);
            if (config.statGrowth === 'none' || !progressionStatEligible(definition, config)
                || !config.statIds.includes(definition.id)) { rejected.push(row); continue; }
            const before = actor.stats?.[row.label];
            const turn = definition.updatePolicy !== 'advancement' && definition.persistence !== 'innate';
            const pool = String(before ?? '').includes('/');
            const bounds = {
                growMaximum: turn && pool,
                fixedMaximum: turn && pool ? (String(definition.maxStatValue ?? '').trim()
                    ? Number(definition.maxStatValue) : null) : configuredNumericMaximum(definition),
            };
            const after = boostStat(before, before, grant.gain, bounds);
            if (after === null) { rejected.push(row); continue; }
            const [oldCurrent, oldMax] = String(before).split('/');
            const [newCurrent, newMax] = after.split('/');
            const provenance = { ...grant, bounds, valueBefore: String(before), valueAfter: after };
            if (oldCurrent !== newCurrent) result.push({ ...row, before: oldCurrent, after: newCurrent, grant: provenance });
            if (oldMax !== newMax) result.push({ ...row, kind: 'stat-max', before: oldMax || '(none)', after: newMax || '(none)', grant: provenance });
            actor.stats[row.label] = after;
            // Scene actors are merged copies; keep their working state for subsequent levels.
            if (row.scope === 'player') working.player.stats[row.label] = after;
            else {
                const live = working.characters?.find(candidate => same(candidate.name, row.actor));
                if (live) live.stats[row.label] = after;
                else {
                    const card = workingCards.find(candidate => same(candidate.name, row.actor));
                    if (card) { card.statusOverrides ||= {}; card.statusOverrides[row.label] = after; }
                }
            }
        } else if (row.kind === 'item-add') {
            const collection = settings.collections?.find(col => col.id === row.collectionId && !col.retired);
            const scope = row.scope === 'player' ? 'player' : 'npc';
            const primary = primaryOf(collection), key = keyOf(row.item, primary);
            const items = actor.collections?.[row.collectionId] || [];
            const validated = validateRewardEntry(collection, row.item);
            if (!collection || !key || !validated.entry || !collectionRewardAppliesTo(collection, scope, actor.npcTemplateId)
                || items.some(item => keyOf(item, primary) === key)
                || result.some(candidate => candidate.kind === 'item-add' && candidate.scope === row.scope && same(candidate.actor, row.actor)
                    && candidate.collectionId === row.collectionId && keyOf(candidate.item, primary) === key)) { rejected.push(row); continue; }
            result.push({ ...row, item: validated.entry });
        } else rejected.push(row);
        appliedIds.add(grant.id);
    }
    return { rows: result, rejected };
}
