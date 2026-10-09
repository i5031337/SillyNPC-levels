export const NPC_TTS_PROVIDER = 'SillyNPC OpenAI Compatible';
export const defaultTtsSettings = Object.freeze({
    enabled: false,
    autoPlay: false,
    model: '',
    npcModel: '',
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
        model: typeof raw.model === 'string' ? raw.model.trim().slice(0, 200) : '',
        npcModel: typeof raw.npcModel === 'string' ? raw.npcModel.trim().slice(0, 200) : '',
        voices,
        narratorVoice: typeof raw.narratorVoice === 'string' ? raw.narratorVoice.trim() : '',
        speed: Number.isFinite(speed) && speed >= 0.25 && speed <= 4 ? speed : 1,
    };
}

export const QWEN_MODEL = 'qwen3-tts';

/** The host proxy forwards voice but drops the local service's NPC fields. */
export function encodeDesignedVoice(card, text) {
    const design = card?.presentation?.voiceDesign;
    if (!design?.description || !card?.id) return '';
    const id = `sn_${String(card.id).replace(/[^A-Za-z0-9_-]/gu, '_')}_v${design.version || 1}`;
    if (id.length > 128) return '';
    const maxNewTokens = Math.min(512, Math.max(128, Math.ceil(String(text).length * 2.5)));
    const json = JSON.stringify({ npc_id: id, instructions: design.description, max_new_tokens: maxNewTokens });
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `sillynpc-v1:${btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')}`;
}

export function resolveUnitSpeech(unit, config, card) {
    if (unit.kind === 'dialogue' && card && config.npcModel === QWEN_MODEL) {
        const binding = card.presentation?.voices?.[NPC_TTS_PROVIDER]
            || card.presentation?.voices?.['OpenAI Compatible'];
        if (binding?.mode === 'disabled') return { voice: null, model: '' };
        const designed = encodeDesignedVoice(card, unit.text);
        return designed ? { voice: designed, model: QWEN_MODEL } : { voice: config.narratorVoice, model: config.model };
    }
    const voice = resolveUnitVoice(unit, config, card);
    if (!voice) return { voice: null, model: '' };
    return { voice, model: unit.kind === 'dialogue' ? config.npcModel || config.model : config.model };
}

export function ttsConfigError(config, endpoint) {
    if (!config.enabled) return 'SillyNPC speech is disabled.';
    try {
        const url = new URL(endpoint);
        if (!['http:', 'https:'].includes(url.protocol)) return 'Set an HTTP or HTTPS endpoint in built-in OpenAI Compatible TTS.';
    } catch { return 'Set an endpoint in built-in OpenAI Compatible TTS.'; }
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
