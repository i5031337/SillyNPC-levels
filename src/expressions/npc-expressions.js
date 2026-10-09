import { eventSource, event_types } from '../../../../../events.js';
import { getContext } from '../../../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { getActiveCharacters } from '../characters/characters.js';
import { readDialogueRecords, dialogueRevision } from '../chat/dialogue-presentation.js';
import { MESSAGE_RENDERED_EVENT } from '../story/beats.js';
import { createExpressionEngine, lastNpcLines, selectSprite } from './expression-engine.js';
import { classifierConfig, classifierHint, classifyDialogue, loadSpritePack } from './host-expressions.js';
import { wireExpressionEvents } from './expression-events.js';

const results = new Map();
let epoch = 0;
const cardFor = id => getActiveCharacters().find(card => card.id === id);
const preferences = card => JSON.stringify(card?.presentation?.expressions);
const messageElement = id => document.querySelector(`#chat .mes[mesid="${Number(id)}"]`);
function isCurrent(job, pending = true) {
    return (!pending || job.epoch === epoch) && getSettings().enabled
        && dialogueRevision(getContext(), job.line.messageId) === job.line.revision
        && preferences(cardFor(job.line.npcId)) === job.preferences
        && JSON.stringify(classifierConfig()) === JSON.stringify(job.config);
}

const engine = createExpressionEngine({ classify: job => job.classify(job), isCurrent,
    apply(job, label) {
        results.set(JSON.stringify([job.line.revision, job.line.npcId]), { ...job, label });
        while (results.size > 128) results.delete(results.keys().next().value);
        renderNpcExpressions(messageElement(job.line.messageId));
    },
});

export function resetNpcExpressions({ clear = true } = {}) {
    epoch++; engine.reset();
    if (clear) results.clear();
    document.querySelectorAll('.sillynpc-chat-avatar[data-sillynpc-base-portrait]').forEach(avatar => {
        avatar.src = avatar.dataset.sillynpcBasePortrait;
        delete avatar.dataset.sillynpcExpression;
        delete avatar.dataset.sillynpcBasePortrait;
    });
}

/** Decoration notifications may read cached pictures, never schedule classification. */
export function renderNpcExpressions(mesEl) {
    if (!mesEl || !getSettings().enabled) return;
    const records = readDialogueRecords(mesEl);
    const byNpc = new Map(records.filter(line => line.npcId).map(line => [line.npcId, line]));
    for (const avatar of mesEl.querySelectorAll('.sillynpc-chat-avatar[data-char-id]')) {
        if (avatar.dataset.sillynpcBasePortrait) avatar.src = avatar.dataset.sillynpcBasePortrait;
        delete avatar.dataset.sillynpcExpression;
        const line = byNpc.get(avatar.dataset.charId);
        if (!line) continue;
        const result = results.get(JSON.stringify([line.revision, line.npcId]));
        if (!result || !isCurrent(result, false)) continue;
        const path = selectSprite(result.sprites, result.label, result.fallback, line.revision + line.npcId);
        if (!path) continue;
        const original = avatar.src;
        avatar.dataset.sillynpcBasePortrait = original;
        avatar.src = path;
        avatar.dataset.sillynpcExpression = result.label || result.fallback;
        const base = () => {
            delete avatar.dataset.sillynpcExpression;
            avatar.onerror = () => avatar.remove(); avatar.src = original;
        };
        avatar.onerror = () => {
            const fallback = selectSprite(result.sprites, result.fallback, '', line.revision + line.npcId);
            if (!fallback || fallback === path) return base();
            avatar.onerror = base; avatar.src = fallback;
            avatar.dataset.sillynpcExpression = result.fallback;
        };
    }
}

/** Explicit completed-reply entry point. No history loading or DOM refresh calls this. */
export async function completeNpcExpressions(messageId, { loadPack = loadSpritePack, classify = classifyDialogue } = {}) {
    if (!getSettings().enabled) return;
    const message = getContext()?.chat?.[Number(messageId)];
    if (!message || message.is_user || message.is_system) return;
    const lines = lastNpcLines(readDialogueRecords(messageElement(messageId)));
    const version = epoch;
    for (const line of lines) {
        const card = cardFor(line.npcId);
        const settings = card?.presentation?.expressions;
        if (!settings?.enabled || !settings.spriteFolder) continue;
        const job = { line, epoch: version, preferences: preferences(card), config: classifierConfig(), classify,
            fallback: settings.fallback, sprites: [] };
        try {
            job.sprites = await loadPack(settings.spriteFolder);
            if (!isCurrent(job)) continue;
            results.set(JSON.stringify([line.revision, line.npcId]), { ...job, label: '' });
            renderNpcExpressions(messageElement(messageId));
            if (job.sprites.length && !classifierHint(job.config)) {
                // The engine serializes all NPC classification, including WebLLM jobs.
                await engine.enqueue(job);
            }
        } catch (error) { console.warn('[SillyNPC] Sprite pack unavailable', error); }
    }
}

export function initNpcExpressions() {
    wireExpressionEvents({ events: eventSource, types: event_types, renderedEvent: MESSAGE_RENDERED_EVENT,
        render: renderNpcExpressions, reset: resetNpcExpressions,
        latestId: () => (getContext()?.chat?.length ?? 0) - 1,
        // Tracker decoration can strip its status block before this frame. Read the final
        // revision afterward; edit/swipe/chat events still cancel the completion token.
        sourceToken: id => getContext()?.chat?.[id],
        revision: id => dialogueRevision(getContext(), id), defer: requestAnimationFrame,
        complete: completeNpcExpressions });
}
