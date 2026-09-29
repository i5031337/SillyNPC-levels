export function existingFillLorebookName(chat, preferred, existing = []) {
    const available = new Set(existing);
    return [chat, preferred].find(name => name && available.has(name)) || '';
}

/** A new chat book must not overwrite another chat's or user's lorebook. */
export function newChatLorebookName(chatId, existing = []) {
    const id = String(chatId ?? '').replace(/[^a-z0-9 -]/gi, '_')
        .replace(/_{2,}/g, '_').trim().slice(0, 44) || 'Story';
    const base = `SillyNPC Chat ${id}`;
    const used = new Set(existing);
    if (!used.has(base)) return base;
    for (let number = 2; ; number++) {
        const candidate = `${base.slice(0, 58)} ${number}`;
        if (!used.has(candidate)) return candidate;
    }
}
