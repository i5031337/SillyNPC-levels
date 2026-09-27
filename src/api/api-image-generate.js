import { chat, getRequestHeaders } from '../../../../../../script.js';
import { getContext } from '../../../../../st-context.js';
import { loadWorldInfo } from '../../../../../world-info.js';
import { executeSlashCommandsOnChatInput } from '../../../../../slash-commands.js';
import { LOG_PREFIX, debugLog, PORTRAIT_SHAPES, DEFAULT_PORTRAIT_SHAPE } from '../core/constants.js';
import { applyMacros } from '../prompts/macros.js';
import { getSettings, defaultSettings, resolveImagePrompt } from '../core/settings.js';
import { recordUsage } from '../core/usage.js';
import { describeConnection } from '../core/utils.js';
import { fillImagePrompt, describeCarriedItems } from './api-lore-facts.js';
import { requestLore } from './api-lore-generate.js';
import { persistGeneratedImage } from './api-image-files.js';

/**
 * Generates a portrait with a Google Gemini image model ("Nano Banana").
 *
 * This bypasses the Stable Diffusion extension deliberately. Its Google source only
 * offers imagen-* and veo-* models, so an account entitled to the Gemini image models
 * cannot generate images through it at all. The Chat Completion backend does support
 * them, behind a request_images flag.
 *
 * The Google API key is read server-side from SillyTavern secrets, so nothing here
 * sends or even reads a credential.
 *
 * @param {string} fullPrompt
 * @returns {Promise<string>} A data: URI for the generated image.
 */
/**
 * The provider's own explanation, wherever it ended up in the body.
 *
 * SillyTavern forwards Google's error JSON largely untouched, so the useful sentence is
 * usually at `error.message` - but `error` is sometimes a bare string, sometimes the
 * literal `true` with nothing else, and a failure that never reached Google at all puts
 * its own text at the top level.
 *
 * @returns {string} Empty when the body carries no readable explanation.
 */
function messageFromErrorBody(body) {
    if (!body || typeof body !== 'object') return '';
    const { error, message } = body;

    if (error && typeof error === 'object' && typeof error.message === 'string') {
        return error.message.trim();
    }
    // `error: true` is a flag, not an explanation.
    if (typeof error === 'string' && error.trim()) return error.trim();
    if (typeof message === 'string' && message.trim()) return message.trim();
    return '';
}

/**
 * The requested portrait shape, or the default if the stored key is unknown.
 *
 * @returns {{ label: string, gemini: string, pixels: { width: number, height: number } | null }}
 */
export function resolvePortraitShape() {
    const key = getSettings().portraitShape;
    return PORTRAIT_SHAPES[key] || PORTRAIT_SHAPES[DEFAULT_PORTRAIT_SHAPE];
}

/**
 * The secret id a chosen connection profile pins, or '' for the active key.
 *
 * Kept separate from the request so a deleted or renamed profile degrades to today's
 * behaviour rather than throwing - the same courtesy requestLore extends to its own
 * profile going missing.
 *
 * @returns {string}
 */
export function resolveImageSecretId() {
    const profileId = getSettings().imageProfileId;
    if (!profileId) return '';
    const profiles = getContext()?.extensionSettings?.connectionManager?.profiles;
    const profile = Array.isArray(profiles) ? profiles.find(p => p?.id === profileId) : null;
    return profile?.['secret-id'] || '';
}

/**
 * Reads an image into a data: URL, which is the only form the API accepts.
 *
 * Portraits are written to disk and remembered by path, but SillyTavern's Google converter
 * only turns a content part into inlineData when the URL starts with "data:" - a path is
 * dropped in silence. Anything already inline is passed straight back.
 *
 * Returns null rather than throwing: a reference that cannot be read should cost you the
 * reference, not the generation.
 *
 * @param {string} src
 * @returns {Promise<string|null>}
 */
export async function toDataUrl(src) {
    if (!src) return null;
    if (src.startsWith('data:')) return src;
    try {
        const response = await fetch(src.startsWith('/') || /^https?:/.test(src) ? src : `/${src}`);
        if (!response.ok) return null;
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const mime = response.headers?.get?.('content-type') || 'image/png';
        return `data:${mime};base64,${btoa(binary)}`;
    } catch (err) {
        debugLog('Could not read reference image', src, err);
        return null;
    }
}

async function generateViaGeminiImage(fullPrompt, referenceImages = [], shape = resolvePortraitShape()) {
    const settings = getSettings();
    const model = settings.geminiImageModel || defaultSettings.geminiImageModel;
    // Omitted entirely when empty. Sending secret_id: '' is not the same as sending
    // nothing: the server reads the active secret only when the field is absent.
    const secretId = resolveImageSecretId();

    debugLog(
        `Portrait -> Google AI Studio / ${model}, `
        + `${settings.imageProfileId
            ? describeConnection(settings.imageProfileId, { includeModel: false })
            : 'key: whichever is active'}`,
    );

    // A plain string when there is nothing to reference, so the request is byte-for-byte
    // what it always was; the parts form only appears once an image is actually attached.
    const usable = referenceImages.filter(Boolean);
    // A reference with no instruction is what made the model reply "what would you like to
    // modify?" instead of drawing: the template is a description, and a description next
    // to a picture reads as conversation rather than a brief.
    const preamble = applyMacros(settings.imgGenReferencePreamble ?? defaultSettings.imgGenReferencePreamble);
    const withReference = preamble ? `${preamble}

${fullPrompt}` : fullPrompt;
    const messageContent = usable.length
        ? [
            { type: 'text', text: withReference },
            ...usable.map(url => ({ type: 'image_url', image_url: { url } })),
        ]
        : fullPrompt;

    // What actually went to the model, not what was meant to. The failure this is for -
    // a text reply where a picture was asked for - is decided entirely by the assembled
    // prompt and whether the pictures really arrived, and neither was visible afterwards.
    debugLog('Portrait request', {
        model,
        references: usable.length,
        // Base64 length, since that is what is sent and what a size limit counts.
        referenceKB: usable.map(url => Math.round(String(url).length / 1024)),
        preamble: preamble ? `${preamble.length} chars, sent first` : 'none - template alone',
        prompt: withReference,
    });

    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({
            chat_completion_source: 'makersuite',
            model,
            messages: [{ role: 'user', content: messageContent }],
            request_images: true,
            request_image_aspect_ratio: shape.gemini,
            ...(secretId ? { secret_id: secretId } : {}),
            max_tokens: 8192,
            stream: false,
        }),
    });

    // Read the body before deciding anything. When Google refuses - a quota spent, a model
    // the key cannot use - SillyTavern logs the real text to its own console and forwards
    // the parsed error to us as an HTTP 500 body. This used to report "HTTP 500" and throw
    // that explanation away, which is why the only way to learn the actual reason was to
    // go and read the server terminal.
    const data = await response.json().catch(() => null);
    const providerMessage = messageFromErrorBody(data);

    if (!response.ok) {
        if (providerMessage) throw new Error(`Google refused the request: ${providerMessage}`);
        // A 400 carrying nothing at all is what a missing key looks like.
        if (response.status === 400) {
            throw new Error(
                'SillyTavern has no Google AI Studio API key saved. Add one under '
                + 'API Connections (Chat Completion -> Google AI Studio); the key is read '
                + 'server-side and is never handled by SillyNPC.',
            );
        }
        throw new Error(
            `Gemini image request failed (HTTP ${response.status}). The provider's reason is `
            + 'printed in the SillyTavern server console - the terminal running it, not the '
            + 'browser.',
        );
    }
    // An error can also arrive with a 200, so the same reading applies on the way through.
    if (data?.error) {
        throw new Error(`Gemini refused the request: ${providerMessage || JSON.stringify(data.error)}`);
    }

    const parts = data?.responseContent?.parts;
    const imagePart = Array.isArray(parts) ? parts.find(p => p?.inlineData?.data) : null;

    if (!imagePart) {
        // A text-only reply almost always means the model declined the prompt, or the
        // selected model is not image-capable. Surface whatever it said.
        const said = (Array.isArray(parts) ? parts.map(p => p?.text).filter(Boolean).join(' ') : '')
            || data?.choices?.[0]?.message?.content
            || '';
        const detail = said ? ` It replied: "${String(said).slice(0, 300)}"` : '';
        throw new Error(
            `The model "${model}" returned text instead of an image.${detail}`
            + ' Check that the selected model can generate images and that the prompt was not refused.',
        );
    }

    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    return `data:${mimeType};base64,${imagePart.inlineData.data}`;
}

/**
 * Logic for generating a character image.
 * @param {object} char Character object
 * @returns {Promise<string>} Image URL or base64
 */
export async function generateCharacterImageLogic(char, { referenceImages = [] } = {}) {
    let loreContext = '';
    if (char.lorebook) {
        const worldData = await loadWorldInfo(char.lorebook.world);
        const entries = worldData.entries;
        const entry = Array.isArray(entries) ? entries.find(e => Number(e.uid) === Number(char.lorebook.uid)) : entries[char.lorebook.uid];
        if (entry) {
            loreContext = entry.content || '';
        }
    }

    const msgCount = Number(getSettings().imgGenContextMessages) || 0;
    // Attributed, like the lore path. Message bodies run together with no speaker is
    // mostly noise in a picture prompt - half of it is someone else talking.
    //
    // Empty rather than a stand-in when Lore Only is chosen: fillImagePrompt takes the
    // whole "Recent scene:" line out on empty, which is what that setting means.
    const recentMessages = msgCount > 0
        ? chat.slice(-msgCount).map(m => `[${m.is_user ? 'User' : (m.name || 'Narrator')}] ${m.mes}`).join('\n')
        : '';

    const fullPrompt = fillImagePrompt(resolveImagePrompt(), {
        name: char.name,
        // Appearance rides in on [LORE] rather than a placeholder of its own: a custom
        // image template replaces the shipped one outright and would never contain a tag
        // invented after it was written.
        lore: [String(char?.profile?.appearance ?? '').trim(), loreContext]
            .filter(Boolean).join('\n\n'),
        items: describeCarriedItems(char),
        context: recentMessages,
    });

    debugLog('Image prompt', fullPrompt);

    return generateImage(fullPrompt, { owner: char, referenceImages });
}

/**
 * Sends a finished prompt to the configured image backend and keeps the result.
 *
 * Split out of generateCharacterImageLogic, which used to build the character's prompt and
 * talk to the backend in one body. Nothing below this line is about characters - it is
 * "draw this, at this shape, and file it with whoever it belongs to" - which is what anything
 * with a prompt of its own and a different frame needs, a place in landscape among them.
 * Portraits pass the same prompt, references and shape they always did.
 *
 * @param {string} fullPrompt
 * @param {object} [options]
 * @param {object|string|null} [options.owner] Whose folder the result is saved into - any
 *   card with a name, as persistGeneratedImage takes it.
 * @param {{ gemini: string, pixels: {width:number,height:number}|null }} [options.shape]
 *   Defaults to the portrait shape setting.
 * @param {string[]} [options.referenceImages]
 * @returns {Promise<string>} The stored path, or the image URL the backend returned.
 */
export async function generateImage(fullPrompt, { owner = null, shape = resolvePortraitShape(), referenceImages = [] } = {}) {
    // Gemini backend: skip the SD extension entirely and go straight to the Chat
    // Completion endpoint, which is the only path that reaches the Gemini image models.
    if (getSettings().imageBackend === 'gemini') {
        // References resolved here rather than at the call site, so a path, a data URL or
        // a mix all arrive in the one form the API takes.
        const resolved = await Promise.all(referenceImages.map(src => toDataUrl(src)));

        // A reference that could not be read used to be filtered out further down, and
        // the portrait was drawn without it - so asking for a likeness and getting a
        // stranger looked exactly like the model ignoring the reference. If a picture was
        // asked for and cannot be sent, that is worth stopping for.
        const unreadable = referenceImages.filter((_, i) => !resolved[i]);
        if (unreadable.length) {
            throw new Error(
                `Could not read ${unreadable.length} of ${referenceImages.length} reference `
                + `image(s), so the portrait was not generated - it would have been drawn `
                + `without them. First one: ${unreadable[0]}`,
            );
        }

        let geminiUrl = await generateViaGeminiImage(fullPrompt, resolved, shape);
        geminiUrl = await persistGeneratedImage(geminiUrl, owner);
        recordUsage('image', { prompt: fullPrompt });
        // Deliberately not assigned: the result is offered as use, keep or discard, so
        // deciding here would make "discard" mean undoing something already done.
        return geminiUrl;
    }

    debugLog('Attempting image generation via slash command /sd');
    
    const negativePrompt = applyMacros(getSettings().imgGenNegativePrompt || defaultSettings.imgGenNegativePrompt);
    
    // Some SD extensions handle multi-line prompts via safe replacement.
    // For the slash command, we must ensure it stays on one line to avoid being split by the parser.
    // We also escape double quotes within the prompt to prevent breaking the slash command.
    const safePrompt = fullPrompt.trim().replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
    const safeNegative = negativePrompt.trim().replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
    
    // Some SD extensions fail if 'prompt=' is explicitly used.
    // We use positional prompt (at the end) for maximum compatibility.
    // Size is a setting now, not a literal. The pixels here are only half the story on
    // Google, which discards them and snaps to the nearest ratio it accepts - see
    // PORTRAIT_SHAPES for why each pair is the pair it is. When the user has asked to keep
    // SillyTavern's own Resolution, we send no dimensions at all rather than a value that
    // would quietly beat it.
    const { pixels } = shape;
    const size = pixels ? `width=${pixels.width} height=${pixels.height} ` : '';
    const command = `/sd quiet=true ${size}negative="${safeNegative}" ${safePrompt}`;
    console.info(LOG_PREFIX, 'Sending SD command:', command);
    
    const result = await executeSlashCommandsOnChatInput(command, { clearChatInput: false });
    recordUsage('image', { prompt: `${fullPrompt} ${negativePrompt}` });

    const extractImageUrl = (res) => {
        if (!res) return null;
        if (typeof res === 'string') {
            const clean = res.trim();
            if (clean.startsWith('http') || clean.startsWith('data:') || clean.startsWith('/') || clean.startsWith('cache/') || /\.(png|jpg|jpeg|webp)$/i.test(clean)) {
                return clean;
            }
            return null;
        }
        if (typeof res === 'object') {
            const url = res.pipe || res.output || res.image || res.url || res.result;
            if (url && typeof url === 'string') {
                const clean = url.trim();
                if (clean.startsWith('http') || clean.startsWith('data:') || clean.startsWith('/') || clean.startsWith('cache/') || /\.(png|jpg|jpeg|webp)$/i.test(clean)) {
                    return clean;
                }
            }
        }
        return null;
    };

    let imageUrl = extractImageUrl(result);
    
    if (!imageUrl) {
        // The /sd command swallows provider errors: generatePicture() catches them,
        // shows its own toast and returns undefined, which the parser then coerces to
        // an empty string. So reaching here means the provider refused the request.
        //
        // There used to be four fallback endpoints tried at this point
        // (/api/extensions/image-generation/generate and friends). None of them exist
        // in SillyTavern, so they only added four failed round-trips before this
        // error. Removed.
        //
        // The message deliberately points at the SERVER console: for the Google
        // backend, SillyTavern's own endpoint logs the provider's real rejection with
        // console.warn and then returns only a generic 'Image generation request
        // failed' to the browser, so DevTools can never show the actual reason.
        throw new Error(
            'The image provider refused the request. '
            + 'The real reason is only printed in the SillyTavern server console '
            + '(the terminal running ST) - not in the browser DevTools. '
            + 'Check that Image Generation is configured and that your provider '
            + 'accepts the request (API tier, region restrictions and safety filters '
            + 'are the usual causes).',
        );
    }

    if (typeof imageUrl === 'string' && imageUrl.length > 100 && !imageUrl.startsWith('data:') && !imageUrl.startsWith('http') && !imageUrl.startsWith('cache/') && !/\.(png|jpg|jpeg|webp)$/i.test(imageUrl)) {
        imageUrl = `data:image/png;base64,${imageUrl}`;
    }

    if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
        imageUrl = await persistGeneratedImage(imageUrl, owner);
    }

    // Not assigned here either - both backends hand the result back for the caller to
    // use, keep or discard.
    return imageUrl;
}
