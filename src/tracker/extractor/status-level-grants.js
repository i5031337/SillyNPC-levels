import { progressXp } from '../progression.js';
import { pointOptions, allocateRandomPoints, pointBudgetRow } from '../level-stat-points.js';
import { resolveProgressionConfig, progressionFieldId } from '../../core/progression-config.js';
import { npcTemplateFor } from '../../core/npc-templates.js';
import { collectionRewardAppliesTo, scheduledCollectionRewards, guidedRewardLevels,
    normalizeCollectionRewards, validateRewardEntry, hasRewardDuplicate, rewardIdentifier } from '../../core/collection-rewards.js';

const key = value => String(value ?? '').toLowerCase();

function matchingCard(name, cards = []) {
    const exact = cards.find(card => key(card.name) === key(name))
        || cards.find(card => (card.aliases || []).some(alias => !alias.isRegex && key(alias.pattern) === key(name)));
    if (exact) return exact;
    return cards.find(card => (card.aliases || []).some(alias => {
        if (!alias.isRegex) return false;
        try { return new RegExp(alias.pattern, 'i').test(String(name ?? '')); }
        catch { return false; }
    }));
}

/** Existing sheets only: initializing or assigning a template never backfills rewards. */
export function collectLevelTransitions(parsed, state, tracker, context = {}) {
    const transitions = [];
    const actors = [{ owner: state?.player, proposal: parsed?.player, scope: 'player' }];
    for (const proposal of Array.isArray(parsed?.characters) ? parsed.characters : []) {
        const card = matchingCard(proposal?.name, context.cards);
        const canonicalName = card?.name || proposal?.name;
        const owner = state?.characters?.find(actor => key(actor.name) === key(canonicalName)) || card;
        actors.push({ owner, proposal, scope: 'character' });
    }
    const seen = new Set();
    for (const { owner, proposal, scope } of actors) {
        if (!owner || !proposal) continue;
        const isPlayer = scope === 'player';
        const template = isPlayer ? null : npcTemplateFor(owner, context.system)
            || tracker.npcTemplates?.find(item => item.id === owner.npcTemplateId);
        const config = resolveProgressionConfig(tracker, { isPlayer, templateId: template?.id, template });
        if (!config.enabled) continue;
        const definitions = (tracker[isPlayer ? 'playerStats' : 'npcStats'] || [])
            .map(def => def.id ? def : { ...def, id: progressionFieldId(def) });
        const xp = definitions.find(def => def.id === config.xpFieldId);
        const level = definitions.find(def => def.id === config.levelFieldId);
        const current = owner.stats || owner.statusOverrides || {};
        const incoming = proposal.stats || proposal;
        const xpKey = Object.keys(incoming).find(name => key(name) === key(xp?.name));
        if (!xp || !level || !xpKey || current[xp.name] === undefined || current[level.name] === undefined) continue;
        const result = progressXp(current[xp.name], incoming[xpKey], current[level.name]);
        if (!result?.levelsGained) continue;
        const card = isPlayer ? null : context.cards?.find(item => key(item.name) === key(owner.name));
        const actorId = isPlayer ? `player:${context.personaId || owner.id || 'player'}`
            : `npc:${owner.id || card?.id || key(owner.name)}`;
        if (seen.has(actorId)) continue;
        seen.add(actorId);
        const oldLevel = Number(current[level.name]);
        const newLevel = Number(result.level);
        const transitionId = JSON.stringify([context.messageId ?? '', context.swipeId ?? 0,
            actorId, config.xpFieldId, config.levelFieldId, oldLevel, newLevel]);
        transitions.push({ scope, actor: isPlayer ? null : owner.name, actorId, templateId: template?.id,
            oldLevel, newLevel, levelsGained: result.levelsGained,
            crossedLevels: Array.from({ length: result.levelsGained }, (_, index) => oldLevel + index + 1),
            xpName: xp.name, levelName: level.name, xpBefore: String(current[xp.name]),
            xpAfter: result.xp, transitionId, config, definitions, current, owner, proposal });
    }
    return transitions;
}

function provenance(transition, level, identity, extra = {}) {
    return { id: `${transition.transitionId}:${level}:${identity}`, transitionId: transition.transitionId,
        actorId: transition.actorId, templateId: transition.templateId,
        oldLevel: transition.oldLevel, newLevel: transition.newLevel, level,
        xpName: transition.xpName, levelName: transition.levelName,
        xpBefore: transition.xpBefore, xpAfter: transition.xpAfter, ...extra };
}

function itemRow(transition, collection, reward, identity, note = '') {
    const fields = collection.fields || [];
    const primary = fields.find(field => field.isPrimary) || fields[0];
    const label = String(reward.entry[primary?.name] ?? rewardIdentifier(collection, reward.entry));
    return { scope: transition.scope, actor: transition.actor, label, collectionId: collection.id,
        kind: 'item-add', before: '(none)', after: label, item: reward.entry, risk: 'risky',
        reason: `Level ${reward.level} collection reward`, note,
        grant: provenance(transition, reward.level, identity, { collectionId: collection.id }) };
}

function collectionSchema(collection) {
    const fields = (collection.fields || []).filter(field => !field.retired && !field.locked);
    const primary = fields.find(field => field.isPrimary) || fields[0];
    return { type: 'object', required: primary ? [primary.name] : [],
        properties: Object.fromEntries(fields.map(field => [field.name, {
            type: ['number', 'boolean'].includes(field.type) ? field.type : 'string',
        }])) };
}

/** Return proposals separately from story changes. Cached valid choices make missing-only retries possible. */
export async function selectLevelGrants(parsed, state, tracker, text, leadUp = [], context = {}) {
    const rows = [], failures = [], tasks = [];
    const cache = { ...(context.cache || {}) };
    const decided = new Set(context.decidedGrantIds || []);
    const transitions = collectLevelTransitions(parsed, state, tracker, context);
    for (const transition of transitions) {
        const points = transition.config.pointsPerLevel * transition.levelsGained;
        if (Number.isSafeInteger(points) && points > 0 && transition.config.statIds.length) {
            const grant = provenance(transition, transition.newLevel, 'points', {
                points, assignment: transition.config.assignment, spent: 0, statIds: transition.config.statIds,
            });
            if (!decided.has(grant.id) && (context.allowNewPointBudgets !== false || Object.hasOwn(cache, grant.id))) {
                if (!Object.hasOwn(cache, grant.id)) {
                    const options = pointOptions(transition.definitions, transition.config, transition.current, points);
                    cache[grant.id] = { points, assignment: grant.assignment, statIds: [...grant.statIds],
                        allocations: grant.assignment === 'random'
                        ? allocateRandomPoints(options, points, context.random) : {} };
                }
                Object.assign(grant, { points: cache[grant.id].points, assignment: cache[grant.id].assignment,
                    statIds: cache[grant.id].statIds });
                rows.push(pointBudgetRow(transition, grant, cache[grant.id].allocations));
            }
        }
        for (const collection of tracker.collections || []) {
            if (!collectionRewardAppliesTo(collection, transition.scope === 'player' ? 'player' : 'npc', transition.templateId)) continue;
            const holdings = transition.owner.collections?.[collection.id]
                || transition.owner.statusCollections?.[collection.id] || [];
            const story = transition.proposal.collections?.[collection.id];
            const additions = Array.isArray(story) ? story : story?.add || story?.replace || [];
            const proposals = [...additions, ...rows.filter(row => row.actor === transition.actor && row.collectionId === collection.id).map(row => row.item)];
            for (const reward of scheduledCollectionRewards(collection, transition.crossedLevels, { holdings, proposals })) {
                const row = itemRow(transition, collection, reward, `schedule:${collection.id}:${reward.id}`);
                if (!decided.has(row.grant.id)) rows.push(row);
            }
            for (const level of guidedRewardLevels(collection, transition.crossedLevels)) {
                tasks.push({ id: provenance(transition, level, `guided:${collection.id}`).id,
                    type: 'collection', transition, level, collection, holdings, proposals });
            }
        }
    }
    const pendingTasks = tasks.filter(task => !decided.has(task.id));
    const missing = pendingTasks.filter(task => !Object.hasOwn(cache, task.id));
    if (missing.length) {
        // Request-local keys keep persistent provenance out of the model's reply.
        const requestTasks = new Map(missing.map((task, index) => [`task-${index + 1}`, task]));
        const choices = [...requestTasks].map(([id, task]) => ({ id, recipient: task.transition.actor || 'Player',
            level: task.level, type: task.type, currentStats: task.transition.current,
            collection: task.collection.name, fields: collectionSchema(task.collection),
            fieldRules: (task.collection.fields || []).filter(field => !field.retired && !field.locked)
                .map(({ name, label, type, guidance, min, maxStatValue, options }) =>
                    ({ name, label, type, guidance, min, maxStatValue, options })),
            guidance: normalizeCollectionRewards(task.collection.levelUpRewards, task.collection).guidance
                || 'Choose a suitable new story-appropriate reward.',
            existing: [...task.holdings, ...task.proposals] }));
        // Match the main reader's Google-compatible schema subset; validate bounds locally.
        const schema = { type: 'object', required: ['choices'], properties: { choices: { type: 'object',
            properties: Object.fromEntries([...requestTasks].map(([id, task]) => [id, { type: 'object',
                properties: { description: { type: 'string' },
                    entry: collectionSchema(task.collection), noReward: { type: 'boolean' } } }])) } } };
        try {
            const request = context.requestExtraction || (await import('./status-extractor-request.js')).requestExtraction;
            const raw = await request(JSON.stringify({ instructions: 'Choose each requested level-up collection reward. Return choices as an object keyed by exact task id. Put all configured collection fields inside entry, not directly under the task id. Alternatively return noReward:true and omit entry when no suitable new reward exists. Never repeat an existing reward. Respect field types, ranges and options. Numeric stat growth is handled by code; do not calculate stats, XP or levels.',
                leadUp, story: text, tasks: choices }), schema, tracker,
            'Return only a JSON object shaped as {"choices":{"task-1":{"entry":{configured collection fields}}}}. Use the requested task ids and field names. Respect each owner, collection field type and bound.');
            const result = typeof raw === 'object' ? raw : (await import('./status-extractor-request.js')).coerceToUpdate(raw);
            const replies = Array.isArray(result?.choices) ? result.choices.map(choice => [choice?.id, choice])
                : result?.choices && typeof result.choices === 'object' ? Object.entries(result.choices)
                    .filter(([, choice]) => choice && typeof choice === 'object' && !Array.isArray(choice)) : [];
            for (const [id, choice] of replies) {
                const task = requestTasks.get(id);
                if (!task) continue;
                // Some readers flatten the entry despite the requested wrapper; validate it identically.
                const entry = Object.hasOwn(choice, 'entry') ? choice.entry : choice;
                cache[task.id] = { ...choice, entry, id: task.id };
            }
        } catch (error) {
            for (const task of missing) failures.push({ id: task.id, actor: task.transition.actor,
                level: task.level, message: String(error?.message || error) });
        }
    }
    for (const task of pendingTasks) {
        const choice = cache[task.id];
        let row = null, error = '';
        if (!choice) error = 'The reader omitted this level-up choice.';
        else if (choice.noReward !== true && choice.entry !== null) {
            const valid = validateRewardEntry(task.collection, choice.entry);
            if (!valid.entry) error = valid.errors.join(' ');
            else {
                const other = rows.filter(item => item.actor === task.transition.actor && item.collectionId === task.collection.id).map(item => item.item);
                if (!hasRewardDuplicate(task.collection, valid.entry, task.holdings, [...task.proposals, ...other])) {
                    row = itemRow(task.transition, task.collection, { level: task.level, entry: valid.entry }, `guided:${task.collection.id}`, String(choice.description || '').slice(0, 180));
                }
            }
        }
        if (error) {
            delete cache[task.id];
            if (!failures.some(failure => failure.id === task.id)) failures.push({ id: task.id,
                actor: task.transition.actor, level: task.level, message: error });
        } else if (row) rows.push(row);
    }
    return { rows, failures, cache };
}
