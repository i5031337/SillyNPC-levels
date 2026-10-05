import { progressXp, boostStat } from '../progression.js';
import { configuredNumericMaximum } from '../numeric-stat-bounds.js';
import { resolveProgressionConfig, progressionStatEligible, progressionFieldId } from '../../core/progression-config.js';
import { npcTemplateFor } from '../../core/npc-templates.js';
import { collectionRewardAppliesTo, scheduledCollectionRewards, guidedRewardLevels,
    normalizeCollectionRewards, validateRewardEntry, hasRewardDuplicate, rewardIdentifier } from '../../core/collection-rewards.js';

const key = value => String(value ?? '').toLowerCase();

const numeric = value => /^\s*-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?\s*$/.test(String(value ?? ''));

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
        const incoming = proposal.stats || (isPlayer ? proposal : {});
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

function eligibleStats(transition) {
    return transition.definitions.filter(def => transition.config.statIds.includes(def.id)
        && progressionStatEligible(def, transition.config) && numeric(transition.current[def.name])
        && statRow(transition, def, transition.oldLevel + 1, 1));
}

function statRow(transition, def, level, gain, note = '') {
    const before = String(transition.current[def.name]);
    // An explicit pool maximum limits expandable capacity; its default pool cap does not.
    const explicitMax = String(def.maxStatValue ?? '').trim();
    const fixedMaximum = before.includes('/') ? (explicitMax ? Number(explicitMax) : null)
        : configuredNumericMaximum(def);
    const bounds = { growMaximum: before.includes('/'), fixedMaximum };
    const after = boostStat(before, undefined, gain, bounds);
    if (after === null || after === before) return null;
    return { scope: transition.scope, actor: transition.actor, label: def.name, kind: 'stat',
        before: before.split('/')[0], after: after.split('/')[0], risk: 'risky',
        reason: `Level ${level} stat growth`, note,
        grant: provenance(transition, level, `stat:${def.id}`, { statId: def.id, gain, bounds }) };
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
        const defs = eligibleStats(transition);
        for (const level of transition.crossedLevels) {
            if (transition.config.statGrowth === 'all') {
                for (const def of defs) {
                    tasks.push({ id: provenance(transition, level, `stat:${def.id}`).id,
                        type: 'stat', transition, level, defs: [def], minimum: 0, maximum: 3 });
                }
            } else if (transition.config.statGrowth === 'one' && defs.length) {
                tasks.push({ id: provenance(transition, level, 'one').id, type: 'stat', transition, level, defs, minimum: 1, maximum: 5 });
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
        const choices = missing.map(task => ({ id: task.id, recipient: task.transition.actor || 'Player',
            level: task.level, type: task.type, currentStats: task.transition.current,
            ...(task.type === 'stat' ? { eligibleStats: task.defs.map(({ id, name, purpose, guidance, maxStatValue }) =>
                ({ id, name, purpose, guidance, maxStatValue })),
                amount: `integer ${task.minimum} through ${task.maximum}` }
                : { collection: task.collection.name, fields: collectionSchema(task.collection),
                    fieldRules: (task.collection.fields || []).filter(field => !field.retired && !field.locked)
                        .map(({ name, label, type, guidance, min, maxStatValue, options }) =>
                            ({ name, label, type, guidance, min, maxStatValue, options })),
                    guidance: normalizeCollectionRewards(task.collection.levelUpRewards, task.collection).guidance
                        || 'Choose a suitable new story-appropriate reward.',
                    existing: [...task.holdings, ...task.proposals] }) }));
        // Match the main reader's Google-compatible schema subset; validate bounds locally.
        const schema = { type: 'object', required: ['choices'], properties: { choices: { type: 'object',
            properties: Object.fromEntries(missing.map(task => [task.id, { type: 'object',
                properties: { description: { type: 'string' },
                    ...(task.type === 'stat' ? { statId: { type: 'string' }, amount: { type: 'number' } }
                        : { entry: collectionSchema(task.collection), noReward: { type: 'boolean' } }) } }])) } } };
        try {
            const request = context.requestExtraction || (await import('./status-extractor-request.js')).requestExtraction;
            const raw = await request(JSON.stringify({ instructions: 'Choose each requested level-up grant. Return choices as an object keyed by exact task id. Stat choices contain an eligible statId and an integer amount within the task range. For All selected stats, choose each stat independently from 0 through 3 at each level: 0 means no increase. Base growth on the story, recipient, and stat purpose; vary increases to reflect what they practiced or accomplished instead of giving every stat the same bonus. For One stat, choose one eligible stat and an increase from 1 through 5. Collection choices contain entry with the configured fields; return noReward:true and omit entry when no suitable new reward exists. Never repeat an existing reward. Respect field types, ranges and options. Do not calculate XP or levels.',
                leadUp, story: text, tasks: choices }), schema, tracker,
            'Return only a JSON object with a choices object keyed by task id. Respect each owner, stat ID, collection field type and bound.');
            const result = typeof raw === 'object' ? raw : (await import('./status-extractor-request.js')).coerceToUpdate(raw);
            const replies = Array.isArray(result?.choices) ? result.choices
                : result?.choices && typeof result.choices === 'object' ? Object.entries(result.choices)
                    .filter(([, choice]) => choice && typeof choice === 'object' && !Array.isArray(choice))
                    .map(([id, choice]) => ({ ...choice, id })) : [];
            for (const choice of replies) {
                if (missing.some(task => task.id === choice?.id)) cache[choice.id] = choice;
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
        else if (task.type === 'stat') {
            const def = task.defs.find(item => item.id === choice.statId);
            if (!def || !Number.isInteger(choice.amount) || choice.amount < task.minimum || choice.amount > task.maximum) error = 'The stat growth choice was invalid.';
            else if (choice.amount > 0) {
                row = statRow(task.transition, def, task.level, choice.amount, String(choice.description || '').slice(0, 180));
                if (row) row.grant.id = task.id;
            }
        } else if (choice.noReward !== true && choice.entry !== null) {
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
