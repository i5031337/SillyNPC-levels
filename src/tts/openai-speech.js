import { getRequestHeaders } from '../../../../../../script.js';
import { extension_settings } from '../../../../../extensions.js';

/** The host owns the destination and its matching OpenAI-compatible TTS secret. */
export function hostSpeechEndpoint() {
    return extension_settings.tts?.['OpenAI Compatible']?.provider_endpoint || '';
}

/** Use SillyTavern's server proxy to avoid browser CORS against a local speech server. */
export async function synthesizeSpeech(unit, config, signal) {
    const endpoint = hostSpeechEndpoint();
    const response = await fetch('/api/openai/custom/generate-voice', {
        method: 'POST', signal, headers: getRequestHeaders(),
        body: JSON.stringify({ provider_endpoint: endpoint, model: config.model,
            input: unit.text, voice: unit.voice, response_format: 'mp3', speed: config.speed }),
    });
    if (!response.ok) throw new Error(`Speech request failed (HTTP ${response.status}).`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('Speech server returned empty audio.');
    return blob;
}

/** Abort stops audible playback and releases the generated object URL. */
export function playSpeechAudio(blob, signal) {
    if (signal.aborted) return Promise.resolve();
    const url = URL.createObjectURL(blob);
    const player = new Audio(url);
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            player.pause();
            player.removeAttribute('src');
            player.load();
            URL.revokeObjectURL(url);
            signal.removeEventListener('abort', abort);
            if (error) reject(error); else resolve();
        };
        const abort = () => finish();
        signal.addEventListener('abort', abort, { once: true });
        player.addEventListener('ended', () => finish(), { once: true });
        player.addEventListener('error', () => finish(new Error('Audio playback failed.')), { once: true });
        player.play().catch(error => finish(error));
    });
}
