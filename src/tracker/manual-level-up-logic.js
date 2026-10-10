import { resolveProgressionConfig, progressionFieldId } from '../core/progression-config.js';
import { templateStatIds } from '../core/system-fields.js';
import { constrainNumericStat } from './numeric-stat-bounds.js';
import { progressXp } from './progression.js';
import { selectLevelGrants, collectLevelTransitions } from './extractor/status-level-grants.js';
import { selectReviewRows, materializeGrantRows, remainingGrantRows } from './level-grant-review.js';

export const MANUAL_LEVEL_UPS_KEY = 'sillynpc_manual_level_ups';
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/** Explicit card actions own their reviews in chat metadata, independently of story readings. */
export function createManualLevelUpService(deps) {
    const busy = new Set();
    const origin = () => ({ metadata: deps.getContext()?.chatMetadata,
        chatId: deps.getContext()?.getCurrentChatId?.(), systemId: deps.getSettings().activeSystem,
        personaId: deps.getPersonaId() });
    const fresh = saved => {
        const current = origin();
        return Object.keys(current).every(key => current[key] === saved[key]);
    };
    const records = cardId => {
        const current = origin();
        if (current.chatId === undefined) return [];
        return (current.metadata?.[MANUAL_LEVEL_UPS_KEY]?.[cardId] || [])
            .filter(record => record.systemId === current.systemId && record.personaId === current.personaId);
    };
    function prune(cardId) {
        const list = deps.getContext().chatMetadata[MANUAL_LEVEL_UPS_KEY]?.[cardId];
        if (!list) return;
        deps.getContext().chatMetadata[MANUAL_LEVEL_UPS_KEY][cardId] = list.filter(record => record.pending.length || record.failures.length);
    }
    function info(cardId) {
        const current = origin();
        const unavailable = reason => ({ enabled: false, reason });
        if (current.chatId === undefined) return unavailable('Open a chat to trigger a level-up.');
        if (!deps.getSettings().enabled) return unavailable('Enable SillyNPC to trigger a level-up.');
        const cards = deps.getCards(), card = cards.find(card => card.id === cardId);
        if (!card || card.isPlayer) return unavailable('This NPC card is not available in the current chat.');
        const tracker = deps.getSettings().statusTracker, state = deps.loadState();
        const scene = state.characters?.find(actor => same(actor.name, card.name));
        const actor = { id: scene?.id || card.id, name: card.name, npcTemplateId: scene?.npcTemplateId || card.npcTemplateId,
            stats: { ...card.statusOverrides, ...scene?.stats },
            collections: structuredClone(scene?.collections || card.statusCollections || {}) };
        const config = resolveProgressionConfig(tracker, { templateId: actor.npcTemplateId });
        if (!config.enabled) return unavailable('Enable progression for this NPC template first.');
        const template = tracker.npcTemplates?.find(t => t.id === actor.npcTemplateId);
        const selected = new Set(templateStatIds({ stats: { character: tracker.npcStats || [] } }, template));
        const definitions = (tracker.npcStats || []).filter(def => selected.has(progressionFieldId(def)));
        for (const def of definitions) {
            actor.stats[def.name] ??= def.defaultValue ?? '';
        }
        const xp = definitions.find(def => progressionFieldId(def) === config.xpFieldId);
        const level = definitions.find(def => progressionFieldId(def) === config.levelFieldId);
        const levelValue = Number(actor.stats[level?.name]);
        if (!Number.isSafeInteger(levelValue) || levelValue < 1) return unavailable('Set a positive whole starting Level first.');
        if (constrainNumericStat(level, String(levelValue + 1), actor.stats[level.name]) !== String(levelValue + 1)) {
            return unavailable('This NPC has reached its configured level cap.');
        }
        const [xpValue, capValue] = String(actor.stats[xp?.name] ?? '').split('/').map(Number);
        if (!Number.isFinite(xpValue) || !Number.isFinite(capValue) || xpValue < 0 || capValue <= 0 || xpValue >= capValue) {
            return unavailable('Set XP to a valid current/threshold reading first.');
        }
        const incoming = `${xpValue + capValue}/${capValue}`;
        const result = progressXp(actor.stats[xp.name], incoming, actor.stats[level.name]);
        if (result?.levelsGained !== 1) return unavailable('The configured counters cannot advance exactly one level.');
        return { enabled: true, reason: '', actor, tracker, cards, xpName: xp.name, levelName: level.name,
            parsed: { characters: [{ name: actor.name, stats: { [xp.name]: incoming } }] }, result };
    }
    const selectionContext = (record, cards) => ({ messageId: record.id, personaId: record.personaId,
        cards, cache: record.cache, decidedGrantIds: record.decidedGrantIds,
        requestExtraction: deps.requestExtraction, random: deps.random });
    const manualRows = rows => rows.map(row => ({ ...row, grant: { ...row.grant, manual: true } }));
    async function trigger(cardId) {
        if (busy.has(cardId)) throw new Error('A level-up is already running for this NPC.');
        const starting = info(cardId);
        if (!starting.enabled) throw new Error(starting.reason);
        const saved = origin();
        busy.add(cardId);
        try {
            const record = { id: `manual:${deps.newId()}`, systemId: saved.systemId, personaId: saved.personaId,
                oldLevel: Number(starting.actor.stats[starting.levelName]), newLevel: Number(starting.result.level),
                parsed: starting.parsed, state: { characters: [structuredClone(starting.actor)] },
                text: `${starting.actor.name} advances by one level through Trigger Level-up.`,
                leadUp: (deps.getContext().chat || []).slice(-2).map(message => ({ role: message.is_user ? 'user' : 'assistant', text: message.mes })),
                cache: {}, decidedGrantIds: [] };
            const context = selectionContext(record, starting.cards);
            const grants = await selectLevelGrants(record.parsed, record.state, starting.tracker, record.text, record.leadUp, context);
            const current = info(cardId);
            if (!fresh(saved) || !current.enabled || !same(current.actor.name, starting.actor.name)
                || current.actor.id !== starting.actor.id
                || current.xpName !== starting.xpName || current.levelName !== starting.levelName
                || current.actor.npcTemplateId !== starting.actor.npcTemplateId
                || current.actor.stats[current.xpName] !== starting.actor.stats[starting.xpName]
                || current.actor.stats[current.levelName] !== starting.actor.stats[starting.levelName]) {
                throw new Error('The chat, system, or NPC counters changed while preparing the level-up.');
            }
            if (!deps.applyUpdate(record.parsed, { admitCharacters: true, label: `Triggered level-up: ${starting.actor.name}` })) {
                throw new Error('The tracker could not apply this level-up.');
            }
            const advanced = info(cardId);
            if (!advanced.enabled || Number(advanced.actor.stats[starting.levelName]) !== record.newLevel) {
                // info may be disabled by the newly reached cap; inspect the stored actor instead.
                const actor = deps.loadState().characters?.find(actor => same(actor.name, starting.actor.name))
                    || { stats: deps.getCards().find(card => card.id === cardId)?.statusOverrides };
                if (Number(actor.stats?.[starting.levelName]) !== record.newLevel) throw new Error('The tracker could not advance this NPC.');
            }
            record.pending = manualRows(grants.rows); record.cache = grants.cache; record.failures = grants.failures;
            record.applied = collectLevelTransitions(record.parsed, record.state, starting.tracker, context)
                .map(transition => ({ transition: { transitionId: transition.transitionId } }));
            saved.metadata[MANUAL_LEVEL_UPS_KEY] ||= {};
            saved.metadata[MANUAL_LEVEL_UPS_KEY][cardId] ||= [];
            saved.metadata[MANUAL_LEVEL_UPS_KEY][cardId].push(record);
            prune(cardId); deps.save();
            return record;
        } finally { busy.delete(cardId); }
    }
    function resolve(cardId, id, accepted, { discardAll = false } = {}) {
        const record = records(cardId).find(record => record.id === id);
        if (!record || !deps.getSettings().enabled) return { applied: 0 };
        const selection = selectReviewRows(record.pending, accepted, record.applied);
        const tracker = deps.getSettings().statusTracker, state = deps.loadState(), cards = deps.getCards();
        const grants = materializeGrantRows(selection.rows, state, tracker, cards, {
            appliedRows: record.applied, personaId: deps.getPersonaId() });
        let recorded = [];
        if (grants.rows.length && deps.applyUpdate(deps.buildUpdate(grants.rows, state, tracker, cards), {
            admitCharacters: true, progressionResolved: true, allowReplace: true, label: 'Reviewed manual level-up rewards',
        })) recorded = grants.rows;
        const remaining = remainingGrantRows(record.pending, selection.rows, grants, recorded, selection.rejectedTransitions, discardAll);
        const outstanding = new Set(remaining.map(row => row.grant.id));
        record.decidedGrantIds.push(...record.pending.filter(row => !outstanding.has(row.grant.id)).map(row => row.grant.id));
        record.pending = remaining; record.applied.push(...recorded);
        if (discardAll) record.failures = [];
        prune(cardId); deps.save();
        return { applied: recorded.length, remaining: remaining.length };
    }
    async function retry(cardId, id) {
        const record = records(cardId).find(record => record.id === id);
        if (!record?.failures.length || busy.has(cardId) || !deps.getSettings().enabled) return false;
        const saved = origin(); busy.add(cardId);
        try {
            const grants = await selectLevelGrants(record.parsed, record.state, deps.getSettings().statusTracker, record.text, record.leadUp,
                { ...selectionContext(record, deps.getCards()), allowNewPointBudgets: false });
            if (!fresh(saved) || !records(cardId).includes(record)) return false;
            const known = new Set([...record.pending.map(row => row.grant.id), ...record.decidedGrantIds]);
            record.pending.push(...manualRows(grants.rows.filter(row => !known.has(row.grant.id))));
            record.cache = grants.cache; record.failures = grants.failures;
            prune(cardId); deps.save(); return true;
        } finally { busy.delete(cardId); }
    }
    return { info, trigger, resolve, retry, records, isBusy: cardId => busy.has(cardId) };
}
