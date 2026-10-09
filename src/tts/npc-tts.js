import { eventSource, event_types } from '../../../../../events.js';
import { getContext } from '../../../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { getActiveCharacters } from '../characters/characters.js';
import { dialogueRevision } from '../chat/dialogue-presentation.js';
import { MESSAGE_RENDERED_EVENT } from '../story/beats.js';
import { readSpeechUnits } from './speech-units.js';
import { createSpeechQueue } from './speech-queue.js';
import { synthesizeSpeech, playSpeechAudio } from './openai-speech.js';
import { normalizeTtsSettings, resolveUnitVoice, ttsConfigError } from './tts-settings.js';
import { builtInAutoTtsEnabled } from '../ui/tts/ui-tts-settings.js';
import { wireSpeechEvents } from './speech-events.js';

const messageElement = id => document.querySelector(`#chat .mes[mesid="${Number(id)}"]`);
let previewController = null;
let configSignature = '';

function updateButtons() {
    const current = queue.current();
    document.querySelectorAll('.sillynpc-tts-play').forEach(button => {
        const playing = Number(button.dataset.messageId) === current?.messageId;
        button.textContent = playing ? 'Stop speech' : 'Play speech';
        button.title = playing ? 'Stop SillyNPC speech' : 'Play this message with SillyNPC voices';
    });
}

const queue = createSpeechQueue({
    synthesize: (unit, signal) => synthesizeSpeech(unit, unit.config, signal),
    playAudio: playSpeechAudio,
    valid: job => getSettings().enabled && getSettings().tts.enabled
        && dialogueRevision(getContext(), job.messageId) === job.revision
        && JSON.stringify(normalizeTtsSettings(getSettings().tts)) === configSignature,
    onState: (state, _job, detail) => {
        updateButtons();
        if (state === 'error') globalThis.toastr?.error(detail?.message || String(detail), 'SillyNPC speech');
    },
});

export function stopNpcTts() {
    queue.stop();
    previewController?.abort();
    previewController = null;
    updateButtons();
}

export async function previewNpcVoice(voice) {
    stopNpcTts();
    const config = normalizeTtsSettings(getSettings().tts);
    const issue = ttsConfigError(config);
    if (issue) throw new Error(issue);
    if (!config.voices.includes(voice)) throw new Error('Voice is not in the SillyNPC voice list.');
    const controller = new AbortController(); previewController = controller;
    try {
        const blob = await synthesizeSpeech({ text: 'This is a SillyNPC voice preview.', voice }, config, controller.signal);
        if (!controller.signal.aborted) await playSpeechAudio(blob, controller.signal);
    } finally { if (previewController === controller) previewController = null; }
}

export async function playNpcMessage(messageId, { automatic = false } = {}) {
    stopNpcTts();
    const settings = getSettings();
    const config = normalizeTtsSettings(settings.tts);
    const issue = !settings.enabled ? 'Enable SillyNPC first.' : ttsConfigError(config);
    if (issue) { if (!automatic) globalThis.toastr?.warning(issue, 'SillyNPC speech'); return; }
    if (automatic && (!config.autoPlay || builtInAutoTtsEnabled())) return;
    const id = Number(messageId);
    const message = getContext()?.chat?.[id];
    if (!message || message.is_user || message.is_system) return;
    const element = messageElement(id);
    if (!element) return;
    const units = readSpeechUnits(element);
    if (!units.length) return;
    const cards = new Map(getActiveCharacters().map(card => [card.id, card]));
    const prepared = units.map(unit => ({ ...unit,
        voice: resolveUnitVoice(unit, config, cards.get(unit.npcId)), config }));
    if (!prepared.some(unit => unit.voice)) return;
    configSignature = JSON.stringify(config);
    await queue.play(id, units[0].revision, prepared);
}

export function renderNpcTtsControl(mesEl) {
    if (!mesEl) return;
    const id = Number(mesEl.getAttribute('mesid'));
    const message = getContext()?.chat?.[id];
    const old = mesEl.querySelector('.sillynpc-tts-play');
    if (!getSettings().enabled || !getSettings().tts.enabled || !message || message.is_user || message.is_system) {
        old?.remove(); return;
    }
    if (old) { updateButtons(); return; }
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'menu_button sillynpc-tts-play';
    button.dataset.messageId = String(id);
    button.textContent = 'Play speech';
    button.title = 'Play this message with SillyNPC voices';
    button.addEventListener('click', () => {
        if (queue.current()?.messageId === id) stopNpcTts();
        else playNpcMessage(id).catch(error => globalThis.toastr?.error(error.message, 'SillyNPC speech'));
    });
    (mesEl.querySelector('.mes_buttons') || mesEl.querySelector('.mes_header') || mesEl).append(button);
}

/** Only a changed foreground reply can initiate automatic speech. */
export function initNpcTts() {
    wireSpeechEvents({ events: eventSource, types: event_types, renderedEvent: MESSAGE_RENDERED_EVENT,
        render: renderNpcTtsControl, stop: stopNpcTts,
        latestId: () => (getContext()?.chat?.length ?? 0) - 1,
        revision: id => dialogueRevision(getContext(), id),
        sourceToken: id => getContext()?.chat?.[id],
        defer: requestAnimationFrame,
        complete: id => playNpcMessage(id, { automatic: true }) });
}
