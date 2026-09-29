import { chat } from '../../../../../../script.js';
import { loadWorldInfo } from '../../../../../world-info.js';
import { executeSlashCommandsOnChatInput } from '../../../../../slash-commands.js';
import { debugLog, PORTRAIT_SHAPES, DEFAULT_PORTRAIT_SHAPE } from '../core/constants.js';
import { applyMacros } from '../prompts/macros.js';
import { getSettings, resolveImagePrompt } from '../core/settings.js';
import { DEFAULT_IMAGE_NEGATIVE_PROMPT } from '../core/settings-defaults.js';
import { recordUsage } from '../core/usage.js';
import { fillImagePrompt, describeCarriedItems } from './api-lore-facts.js';
import { characterImageDescription } from './api-image-description.js';
import { persistGeneratedImage } from './api-image-files.js';

/** The configured shape, or the current default for an unknown stored value. */
export function resolvePortraitShape() {
    return PORTRAIT_SHAPES[getSettings().portraitShape] || PORTRAIT_SHAPES[DEFAULT_PORTRAIT_SHAPE];
}

/** Build a character's prompt, then ask SillyTavern's Image Generation extension to draw it. */
export async function generateCharacterImageLogic(char, { includeScene = true } = {}) {
    let loreContext = '';
    if (char.lorebook) {
        const worldData = await loadWorldInfo(char.lorebook.world);
        const entries = worldData.entries;
        const entry = Array.isArray(entries) ? entries.find(e => Number(e.uid) === Number(char.lorebook.uid)) : entries[char.lorebook.uid];
        if (entry) loreContext = entry.content || '';
    }

    const msgCount = Number(getSettings().imgGenContextMessages) || 0;
    const recentMessages = includeScene && msgCount > 0
        ? chat.slice(-msgCount).map(m => `[${m.is_user ? 'User' : (m.name || 'Narrator')}] ${m.mes}`).join('\n')
        : '';
    const fullPrompt = fillImagePrompt(resolveImagePrompt(), {
        name: char.name,
        lore: characterImageDescription(char, loreContext),
        items: describeCarriedItems(char),
        context: recentMessages,
    });
    debugLog('Image prompt', fullPrompt);
    return generateImage(fullPrompt, { owner: char });
}

function escapeCommandValue(value) {
    return String(value || '').trim().replace(/\r?\n/g, ' ').replace(/"/g, '\\"');
}

function imageUrlFromResult(result) {
    const candidate = typeof result === 'string' ? result
        : result && typeof result === 'object' ? result.pipe || result.output || result.image || result.url || result.result : '';
    const url = String(candidate || '').trim();
    return /^(?:https?:|data:|\/|cache\/)/i.test(url) || /\.(?:png|jpe?g|webp)(?:\?.*)?$/i.test(url) ? url : '';
}

/** Return the generated image for caller review; the caller decides whether to use it. */
export async function generateImage(fullPrompt, { owner = null, shape = resolvePortraitShape() } = {}) {
    const negative = applyMacros(DEFAULT_IMAGE_NEGATIVE_PROMPT);
    const pixels = shape?.pixels;
    const size = pixels ? `width=${pixels.width} height=${pixels.height} ` : '';
    // The host command handles provider selection, credentials, gallery saving and errors.
    const command = `/imagine quiet=true ${size}negative="${escapeCommandValue(negative)}" ${escapeCommandValue(fullPrompt)}`;
    debugLog('Sending Image Generation command', command);
    const result = await executeSlashCommandsOnChatInput(command, { clearChatInput: false });
    let imageUrl = imageUrlFromResult(result);
    if (!imageUrl) {
        throw new Error('Image Generation did not return an image. Check its settings and the error shown by SillyTavern.');
    }
    if (imageUrl.startsWith('data:')) imageUrl = await persistGeneratedImage(imageUrl, owner);
    recordUsage('image', { prompt: `${fullPrompt} ${negative}` });
    return imageUrl;
}
