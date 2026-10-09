const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = value => typeof value === 'string' ? value.trim() : '';

/** Sprite storage accepts a folder and at most one subfolder, never a URL or file path. */
export function normalizeSpriteFolder(value) {
    const folder = text(value);
    const parts = folder.split('/');
    if (!folder || parts.length > 2 || parts.some(part => !part || part === '.' || part === '..')
        || /[\\:\x00-\x1f\x7f?#]/u.test(folder)) return '';
    return folder;
}

/** Portable preferences only; asset and voice availability is checked by runtime adapters. */
export function normalizeNpcPresentation(value, { imported = false } = {}) {
    const raw = object(value);
    const expressions = object(raw.expressions);
    const spriteFolder = normalizeSpriteFolder(expressions.spriteFolder);
    const bindingStatus = (binding, hasReference) => hasReference && (imported || binding?.bindingStatus === 'unresolved')
        ? 'unresolved' : 'unverified';
    const voices = {};
    for (const [provider, entry] of Object.entries(object(raw.voices))) {
        if (!provider.trim() || ['__proto__', 'constructor', 'prototype'].includes(provider)) continue;
        const voice = object(entry);
        const mode = ['default', 'voice', 'disabled'].includes(voice.mode) ? voice.mode : 'default';
        voices[provider] = {
            mode,
            voiceId: mode === 'voice' ? text(voice.voiceId) : '',
            voiceName: mode === 'voice' ? text(voice.voiceName) : '',
            bindingStatus: bindingStatus(voice, mode === 'voice' && Boolean(text(voice.voiceId) || text(voice.voiceName))),
        };
    }
    return {
        expressions: {
            enabled: expressions.enabled === true,
            spriteFolder,
            fallback: text(expressions.fallback) || 'neutral',
            bindingStatus: bindingStatus(expressions, Boolean(spriteFolder)),
        },
        voices,
    };
}

/** Repair cards in either settings or chat metadata without replacing valid editor references. */
export function normalizeCharacterPresentation(card, options) {
    const presentation = normalizeNpcPresentation(card.presentation, options);
    if (JSON.stringify(card.presentation) !== JSON.stringify(presentation)) card.presentation = presentation;
    return card.presentation;
}
