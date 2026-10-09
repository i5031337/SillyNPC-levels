import { normalizeCharacterPresentation } from '../../core/npc-presentation.js';
import { isChatCharacter } from '../../characters/character-repository.js';
import { saveSettings, getSettings } from '../../core/settings.js';
import { NPC_TTS_PROVIDER, QWEN_MODEL } from '../../tts/tts-settings.js';
import { previewNpcVoice, stopNpcTts } from '../../tts/npc-tts.js';
import { getContext } from '../../../../../../st-context.js';

export function buildVoicesSection(card, { save = () => {
    if (isChatCharacter(card.id)) getContext()?.saveMetadataDebounced?.();
    else saveSettings();
}, previewVoice = previewNpcVoice } = {}) {
    const root = document.createElement('fieldset'); root.className = 'sillynpc-voice-editor';
    const legend = document.createElement('legend'); legend.textContent = 'Dialogue voice'; root.append(legend);
    const note = document.createElement('p');
    note.textContent = 'Uses the built-in OpenAI Compatible endpoint and API key. Set speech models in SillyNPC settings.';
    root.append(note);
    const select = document.createElement('select'); select.className = 'text_pole';
    select.setAttribute('aria-label', 'NPC dialogue voice'); root.append(select);
    const description = document.createElement('textarea');
    description.className = 'text_pole'; description.rows = 3; description.maxLength = 500;
    description.setAttribute('aria-label', 'NPC voice description');
    const descriptionLabel = document.createElement('label');
    descriptionLabel.textContent = 'Designed voice description'; descriptionLabel.append(description); root.append(descriptionLabel);
    const version = document.createElement('p'); root.append(version);
    const preview = document.createElement('button'); preview.type = 'button'; preview.className = 'menu_button';
    preview.textContent = 'Preview voice'; root.append(preview);
    const status = document.createElement('p'); status.setAttribute('role', 'status'); root.append(status);
    let config;
    const refresh = () => {
        config = getSettings().tts;
        const presentation = normalizeCharacterPresentation(card);
        const saved = presentation.voices;
        const binding = saved[NPC_TTS_PROVIDER] || saved['OpenAI Compatible'];
        const designed = config.npcModel === QWEN_MODEL;
        descriptionLabel.hidden = !designed;
        version.hidden = !designed;
        description.value = presentation.voiceDesign.description;
        version.textContent = `Voice version ${presentation.voiceDesign.version}. Changing the description creates a new voice on the next spoken line.`;
        select.replaceChildren();
        for (const [value, label] of [['default', 'Use narrator voice'], ['disabled', 'Silent'],
            ...(designed ? [] : config.voices.map(voice => [`voice:${voice}`, voice]))]) {
            const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
        }
        if (designed) select.options[0].textContent = 'Use designed voice';
        const voice = config.voices.find(id => id === binding?.voiceId)
            || config.voices.find(id => id === binding?.voiceName);
        if (!designed && binding?.mode === 'voice' && !voice) {
            const option = document.createElement('option'); option.value = 'missing';
            option.textContent = `Missing voice: ${binding.voiceName || binding.voiceId}`;
            select.append(option); select.value = 'missing';
            status.textContent = 'Saved voice is unavailable. Choose another voice or Silent.';
        } else {
            select.value = designed ? (binding?.mode === 'disabled' ? 'disabled' : 'default')
                : binding?.mode === 'voice' ? `voice:${voice}` : binding?.mode || 'default';
            status.textContent = designed ? 'Describe this NPC voice before playback. Preview also creates its persistent voice.'
                : config.voices.length ? `${config.voices.length} voices configured.`
                    : 'Add voices in SillyNPC speech settings.';
        }
        preview.disabled = !config.enabled || (designed
            ? select.value === 'disabled' || !presentation.voiceDesign.description
            : !select.value.startsWith('voice:'));
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
        preview.disabled = !config.enabled || (config.npcModel === QWEN_MODEL
            ? select.value === 'disabled' || !card.presentation.voiceDesign.description : !voice);
        status.textContent = 'SillyNPC voice preference saved.';
    });
    description.addEventListener('change', () => {
        const design = normalizeCharacterPresentation(card).voiceDesign;
        const next = description.value.trim().slice(0, 500);
        if (next === design.description) return;
        design.description = next;
        design.version = Number.isSafeInteger(design.version + 1) ? design.version + 1 : 1;
        stopNpcTts(); save(); refresh();
    });
    preview.addEventListener('click', async () => {
        const voice = select.value.startsWith('voice:') ? select.value.slice(6) : '';
        if (!voice && config.npcModel !== QWEN_MODEL) return;
        preview.disabled = true; status.textContent = 'Starting voice preview…';
        try { await previewVoice(voice, card); status.textContent = 'Voice preview finished.'; }
        catch (error) { status.textContent = `Voice preview failed: ${error?.message || error}`; }
        preview.disabled = !config.enabled || (config.npcModel === QWEN_MODEL
            ? select.value === 'disabled' || !card.presentation.voiceDesign.description
            : !select.value.startsWith('voice:'));
    });
    refresh();
    return root;
}
