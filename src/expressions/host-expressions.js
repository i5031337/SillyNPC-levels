import { extension_settings } from '../../../../../extensions.js';
import { normalizeSpriteFolder } from '../core/npc-presentation.js';

export function classifierConfig() {
    const settings = extension_settings.expressions || {};
    return { api: settings.api, promptType: settings.promptType, translate: settings.translate,
        custom: [...(settings.custom || [])], fallback: settings.fallback_expression };
}

export function classifierHint(config = classifierConfig()) {
    if (config.api === 2) return config.promptType === 'full'
        ? 'Choose Local, Extras, or WebLLM in Expressions. Full LLM mode includes conversation context.'
        : 'Choose Local, Extras, or WebLLM in Expressions. Main LLM classification needs a shared host request lock.';
    if (![0, 1, 3].includes(config.api)) return 'Choose Local, Extras, or WebLLM in the host Expressions settings to classify NPC dialogue.';
    return '';
}

export async function loadSpritePack(folder) {
    const valid = normalizeSpriteFolder(folder);
    if (!valid) return [];
    const response = await fetch(`/api/sprites/get?name=${encodeURIComponent(valid)}`);
    if (!response.ok) throw new Error('Sprite pack could not be loaded.');
    const sprites = await response.json();
    return Array.isArray(sprites) ? sprites.filter(sprite => typeof sprite.label === 'string'
        && typeof sprite.path === 'string' && sprite.path.startsWith('/characters/')) : [];
}

export async function classifyDialogue({ line, sprites, config }) {
    if (classifierHint(config)) return '';
    const host = await import('../../../../../extensions/expressions/index.js');
    const labels = [...new Set(sprites.map(sprite => sprite.label))];
    if (!labels.length) return '';
    // Filtering in the host helper uses the native character's pack, so constrain our prompt explicitly.
    const customPrompt = `Classify the emotion of the supplied dialogue only. Return exactly one label from: ${labels.join(', ')}. No explanation.`;
    return await host.getExpressionLabel(line.text, config.api, { filterAvailable: false, customPrompt });
}
