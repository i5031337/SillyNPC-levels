import { extension_settings } from '../../../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../../../script.js';
import { getSettings } from '../../core/settings.js';
import { normalizeTtsSettings, ttsConfigError } from '../../tts/tts-settings.js';

const nativeAuto = () => extension_settings.tts?.enabled
    && (extension_settings.tts.auto_generation || extension_settings.tts.periodic_auto_generation);

export function renderTtsSettings({ onChange = () => {}, preview = () => {} } = {}) {
    const root = document.getElementById('sillynpc-tts-settings');
    if (!root) return;
    const config = getSettings().tts;
    const field = (label, input) => {
        const wrapper = document.createElement('label'); wrapper.textContent = label;
        wrapper.append(input); root.append(wrapper); return input;
    };
    const input = (type, value) => {
        const element = document.createElement('input'); element.type = type;
        if (type !== 'checkbox') element.className = 'text_pole';
        if (type === 'checkbox') element.checked = value; else element.value = value;
        return element;
    };
    const enabled = field('Enable SillyNPC speech', input('checkbox', config.enabled));
    const auto = field('Automatically play completed replies', input('checkbox', config.autoPlay));
    const endpoint = field('OpenAI-compatible speech endpoint', input('url', config.endpoint));
    endpoint.placeholder = 'http://127.0.0.1:8880/v1/audio/speech';
    const model = field('Speech model', input('text', config.model));
    const voices = field('Available voices (comma separated)', input('text', config.voices.join(', ')));
    const narrator = document.createElement('select'); narrator.className = 'text_pole';
    field('Narrator voice', narrator);
    const speed = field('Speed', input('number', config.speed)); speed.min = '0.25'; speed.max = '4'; speed.step = '0.05';
    const actions = document.createElement('div'); actions.className = 'sillynpc-voice-actions'; root.append(actions);
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'menu_button';
    copy.textContent = 'Copy built-in OpenAI Compatible setup'; actions.append(copy);
    const sample = document.createElement('button'); sample.type = 'button'; sample.className = 'menu_button';
    sample.textContent = 'Preview narrator'; actions.append(sample);
    const status = document.createElement('p'); status.setAttribute('role', 'status'); root.append(status);
    const refreshNarrator = () => {
        narrator.replaceChildren();
        for (const voice of config.voices) {
            const option = document.createElement('option'); option.value = voice; option.textContent = voice;
            narrator.append(option);
        }
        narrator.value = config.narratorVoice;
    };
    const refreshStatus = () => {
        const issue = ttsConfigError(config);
        status.textContent = config.enabled && config.autoPlay && nativeAuto()
            ? 'Built-in TTS automatic narration is also on. Turn it off to avoid duplicate speech.'
            : issue || 'SillyNPC speech is ready. The built-in TTS settings are independent.';
    };
    const persist = () => { onChange(); saveSettingsDebounced(); refreshStatus(); };
    enabled.addEventListener('change', () => { config.enabled = enabled.checked; persist(); });
    auto.addEventListener('change', () => { config.autoPlay = auto.checked; persist(); });
    endpoint.addEventListener('change', () => { config.endpoint = endpoint.value.trim(); persist(); });
    model.addEventListener('change', () => { config.model = model.value.trim(); persist(); });
    voices.addEventListener('change', () => {
        config.voices = [...new Set(voices.value.split(',').map(value => value.trim()).filter(Boolean))].slice(0, 100);
        refreshNarrator(); persist();
    });
    narrator.addEventListener('change', () => { config.narratorVoice = narrator.value; persist(); });
    speed.addEventListener('change', () => { config.speed = normalizeTtsSettings({ speed: speed.value }).speed; speed.value = config.speed; persist(); });
    copy.addEventListener('click', () => {
        const source = extension_settings.tts?.['OpenAI Compatible'];
        if (!source?.provider_endpoint) { status.textContent = 'No built-in OpenAI Compatible setup to copy.'; return; }
        config.endpoint = source.provider_endpoint;
        config.model = source.model || '';
        const listed = Array.isArray(source.available_voices) ? source.available_voices
            : String(source.available_voices || '').split(',');
        config.voices = [...new Set(listed.map(value => String(value).trim()).filter(Boolean))];
        config.narratorVoice = config.voices.includes(config.narratorVoice) ? config.narratorVoice : config.voices[0] || '';
        endpoint.value = config.endpoint; model.value = config.model; voices.value = config.voices.join(', ');
        refreshNarrator(); persist();
    });
    sample.addEventListener('click', async () => {
        sample.disabled = true; status.textContent = 'Starting narrator preview…';
        try { await preview(config.narratorVoice); status.textContent = 'Narrator preview finished.'; }
        catch (error) { status.textContent = `Narrator preview failed: ${error?.message || error}`; }
        sample.disabled = false;
    });
    document.addEventListener('change', event => {
        if (event.target?.matches?.('#tts_enabled, #tts_auto_generation, #tts_periodic_auto_generation')) refreshStatus();
    });
    refreshNarrator(); refreshStatus();
}

export function builtInAutoTtsEnabled() { return Boolean(nativeAuto()); }
