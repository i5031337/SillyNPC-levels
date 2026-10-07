import { buildMemoryBatch, validateMemoryResponse } from './memory-batch.js';
import { firstChangedMemorySource, memorySourcesMatch, invalidateMemoryStore } from '../core/profile-memories.js';
import { readNpcMemories, writeNpcMemories } from '../tracker/npc-memories.js';
import { buildMemoryPrompt, MEMORY_SYSTEM_PROMPT, MEMORY_RESPONSE_SCHEMA } from './memory-prompt.js';

export const MEMORY_PROGRESS_KEY = 'sillynpc_memory_progress';

/** Dependencies keep the request lifecycle testable without loading SillyTavern. */
export function createMemoryService(deps) {
    let active = null;
    const config = () => {
        const settings = deps.getSettings();
        return settings.statusTracker?.presets?.[settings.activeSystem]?.definition?.memories || {};
    };
    const progressMap = context => context.chatMetadata[MEMORY_PROGRESS_KEY] ||= {};
    const signature = () => JSON.stringify([deps.getSettings().activeSystem, config()]);
    const identity = context => context.getCurrentChatId?.() ?? context.chatId;
    const pending = chat => chat.flatMap((_, id) => deps.getPending(id));

    function reconcile() {
        const context = deps.getContext();
        if (!context?.chatMetadata || !Array.isArray(context.chat) || identity(context) == null) return;
        const chat = context.chat;
        let changed = false;
        for (const record of Object.values(context.chatMetadata[MEMORY_PROGRESS_KEY] || {})) {
            const from = firstChangedMemorySource(chat, record.sources || []);
            if (from !== null) {
                record.checkpoint = Math.min(record.checkpoint, from - 1);
                record.sources = record.sources.filter(source => source.messageId < from);
                changed = true;
            }
        }
        for (let id = 0; id < chat.length; id++) {
            const rows = deps.getPending(id);
            const valid = rows.filter(row => row.kind !== 'memory-add'
                || row.provenance?.sources?.length && memorySourcesMatch(chat, row.provenance.sources)
                    && (row.provenance?.chatId === undefined || row.provenance.chatId === String(identity(context))));
            if (valid.length !== rows.length) { deps.replacePending(id, valid); changed = true; }
        }
        const state = deps.loadState();
        const cards = [];
        for (const card of deps.getCards().filter(card => !card.isPlayer)) {
            const result = invalidateMemoryStore(readNpcMemories(state, card), chat);
            if (!result.removed.length) continue;
            writeNpcMemories(state, card, result.store);
            cards.push(card);
        }
        if (cards.length) {
            deps.saveState(state, { label: 'Memory sources changed' });
            for (const card of cards) deps.syncLore(card, readNpcMemories(state, card));
            changed = true;
        }
        if (changed) deps.saveChat();
    }

    async function read({ manual = false } = {}) {
        if (active) return { ok: false, reason: 'A memory reading is already running.' };
        if (deps.busy?.()) return { ok: false, reason: 'Wait for the current generation or tracker reading to finish.' };
        const settings = deps.getSettings();
        if (!settings.enabled || config().enabled !== true) return { ok: false, reason: 'NPC memory capture is disabled for this System.' };
        const context = deps.getContext();
        if (!context?.chatMetadata || identity(context) == null || !context.chat?.length) {
            return { ok: false, reason: 'Open a chat before reading memories.' };
        }
        reconcile();
        const systemId = settings.activeSystem;
        const records = progressMap(context);
        const record = records[systemId] || { checkpoint: -1, sources: [] };
        let batch;
        try { batch = buildMemoryBatch(context.chat, record.checkpoint); }
        catch (error) { return { ok: false, reason: error.message }; }
        if (!batch) return { ok: true, pending: 0, messages: 0 };
        if (!manual && batch.unreadReplies < (config().interval || 8)) {
            return { ok: false, reason: 'Not enough new replies for a memory pass.' };
        }
        const state = deps.loadState();
        const text = batch.messages.filter(message => message.unread)
            .map(message => `${message.speaker}\n${message.text}`).join('\n').toLocaleLowerCase();
        const sceneNames = new Set((state.characters || []).map(actor => actor.name?.toLocaleLowerCase()));
        const cards = deps.getCards().filter(card => !card.isPlayer && card.id != null && card.name
            && (sceneNames.has(card.name.toLocaleLowerCase()) || [card.name, ...(card.aliases || [])
                .filter(alias => !alias?.isRegex).map(alias => typeof alias === 'string' ? alias : alias?.pattern)]
                .some(name => typeof name === 'string' && name.trim() && text.includes(name.toLocaleLowerCase()))))
            .map(card => ({ ...card, memories: readNpcMemories(state, card) }));
        const run = { context, chat: context.chat, chatId: identity(context), signature: signature() };
        const isCurrent = () => deps.getSettings().enabled && config().enabled === true
            && deps.getContext()?.chat === run.chat && identity(deps.getContext()) === run.chatId
            && signature() === run.signature && memorySourcesMatch(run.chat, batch.sources);
        active = run;
        deps.onBusy?.();
        try {
            let rows = [];
            if (cards.length) {
                const raw = await deps.request(buildMemoryPrompt(batch, cards, config().guidance), MEMORY_RESPONSE_SCHEMA,
                    { ...settings.statusTracker, extractionMaxTokens: 1800 }, MEMORY_SYSTEM_PROMPT, { usageKind: 'memory' });
                if (!isCurrent()) return { ok: false, reason: 'The chat, System, or supporting replies changed during the reading. Read again.' };
                rows = validateMemoryResponse(deps.parse(raw), { cards, batch,
                    pending: pending(run.chat), systemId, chatId: run.chatId });
            }
            if (!isCurrent()) return { ok: false, reason: 'The memory reading is no longer current.' };
            if (rows.length) deps.enqueue(batch.checkpoint, rows);
            const sources = new Map(record.sources.map(source => [source.messageId, source]));
            for (const source of batch.sources) sources.set(source.messageId, source);
            records[systemId] = { checkpoint: batch.checkpoint, sources: [...sources.values()] };
            deps.saveChat();
            return { ok: true, pending: rows.length, messages: batch.messages.filter(message => message.unread).length,
                remainingReplies: batch.unreadReplies - batch.replyCount };
        } catch (error) {
            return { ok: false, reason: String(error?.message || error) };
        } finally {
            if (active === run) active = null;
            deps.onBusy?.();
        }
    }
    return { read, reconcile, busy: () => Boolean(active) };
}
