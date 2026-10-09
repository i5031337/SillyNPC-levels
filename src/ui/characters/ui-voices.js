import { normalizeCharacterPresentation } from '../../core/npc-presentation.js';
import { isChatCharacter } from '../../characters/character-repository.js';
import { saveSettings, getSettings } from '../../core/settings.js';
import { NPC_TTS_PROVIDER } from '../../tts/tts-settings.js';
import { previewNpcVoice, stopNpcTts } from '../../tts/npc-tts.js';
import { getContext } from '../../../../../../st-context.js';

export function buildVoicesSection(card, { save = () => {
    if (isChatCharacter(card.id)) getContext()?.saveMetadataDebounced?.();
    else saveSettings();
}, previewVoice = previewNpcVoice } = {}) {
    const root = document.createElement('fieldset'); root.className = 'sillynpc-voice-editor';
    const legend = document.createElement('legend'); legend.textContent = 'Dialogue voice'; root.append(legend);
    const note = document.createElement('p');
    note.textContent = 'Uses the built-in OpenAI Compatible endpoint and API key. Set the model and voice list in SillyNPC speech settings.';
    root.append(note);
    const select = document.createElement('select'); select.className = 'text_pole';
    select.setAttribute('aria-label', 'NPC dialogue voice'); root.append(select);
    const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'menu_button';
    preview.textContent = 'Preview voice'; root.append(preview);
    const status = document.createElement('p'); status.setAttribute('role', 'status'); root.append(status);
    let config;
    const refresh = () => {
        config = getSettings().tts;
        const saved = normalizeCharacterPresentation(card).voices;
        const binding = saved[NPC_TTS_PROVIDER] || saved['OpenAI Compatible'];
        select.replaceChildren();
        for (const [value, label] of [['default', 'Use narrator voice'], ['disabled', 'Silent'],
            ...config.voices.map(voice => [`voice:${voice}`, voice])]) {
            const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
        }
        const voice = config.voices.find(id => id === binding?.voiceId)
            || config.voices.find(id => id === binding?.voiceName);
        if (binding?.mode === 'voice' && !voice) {
            const option = document.createElement('option'); option.value = 'missing';
            option.textContent = `Missing voice: ${binding.voiceName || binding.voiceId}`;
            select.append(option); select.value = 'missing';
            status.textContent = 'Saved voice is unavailable. Choose another voice or Silent.';
        } else {
            select.value = binding?.mode === 'voice' ? `voice:${voice}` : binding?.mode || 'default';
            status.textContent = config.voices.length ? `${config.voices.length} voices configured.`
                : 'Add voices in SillyNPC speech settings.';
        }
        preview.disabled = !config.enabled || !select.value.startsWith('voice:');
    };
    select.addEventListener('change', () => {
        if (select.value === 'missing') return;
        const voice = select.value.startsWith('voice:') ? select.value.slice(6) : '';
        normalizeCharacterPresentation(card).voices[NPC_TTS_PROVIDER] = {
            mode: voice ? 'voice' : select.value, voiceId: voice, voiceName: voice,
            bindingStatus: 'unverified',
        };
        stopNpcTts();
        save();
        preview.disabled = !config.enabled || !voice;
        status.textContent = 'SillyNPC voice preference saved.';
    });
    preview.addEventListener('click', async () => {
        const voice = select.value.startsWith('voice:') ? select.value.slice(6) : '';
        if (!voice) return;
        preview.disabled = true; status.textContent = 'Starting voice preview…';
        try { await previewVoice(voice); status.textContent = 'Voice preview finished.'; }
        catch (error) { status.textContent = `Voice preview failed: ${error?.message || error}`; }
        preview.disabled = !config.enabled;
    });
    refresh();
    return root;
}
