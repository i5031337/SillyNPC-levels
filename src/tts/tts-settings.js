export const NPC_TTS_PROVIDER = 'SillyNPC OpenAI Compatible';
export const defaultTtsSettings = Object.freeze({
    enabled: false,
    autoPlay: false,
    endpoint: '',
    model: '',
    voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
    narratorVoice: 'alloy',
    speed: 1,
});

const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export function normalizeTtsSettings(value) {
    const raw = object(value);
    const voices = [...new Set((Array.isArray(raw.voices) ? raw.voices : defaultTtsSettings.voices)
        .map(voice => typeof voice === 'string' ? voice.trim() : '').filter(Boolean))].slice(0, 100);
    const speed = Number(raw.speed);
    return {
        enabled: raw.enabled === true,
        autoPlay: raw.autoPlay === true,
        endpoint: typeof raw.endpoint === 'string' ? raw.endpoint.trim().slice(0, 500) : '',
        model: typeof raw.model === 'string' ? raw.model.trim().slice(0, 200) : '',
        voices,
        narratorVoice: typeof raw.narratorVoice === 'string' ? raw.narratorVoice.trim() : '',
        speed: Number.isFinite(speed) && speed >= 0.25 && speed <= 4 ? speed : 1,
    };
}

export function ttsConfigError(config) {
    if (!config.enabled) return 'SillyNPC speech is disabled.';
    try {
        const url = new URL(config.endpoint);
        if (!['http:', 'https:'].includes(url.protocol)) return 'Use an HTTP or HTTPS speech endpoint.';
    } catch { return 'Enter an OpenAI-compatible speech endpoint.'; }
    if (!config.model) return 'Enter a speech model.';
    if (!config.narratorVoice || !config.voices.includes(config.narratorVoice)) return 'Choose an available narrator voice.';
    return '';
}

export function resolveUnitVoice(unit, config, card) {
    if (unit.kind !== 'dialogue' || !card) return config.narratorVoice;
    const binding = card.presentation?.voices?.[NPC_TTS_PROVIDER]
        || card.presentation?.voices?.['OpenAI Compatible'];
    if (binding?.mode === 'disabled') return null;
    if (binding?.mode !== 'voice') return config.narratorVoice;
    const voice = config.voices.find(id => id === binding.voiceId)
        || config.voices.find(id => id === binding.voiceName);
    return voice || null;
}
