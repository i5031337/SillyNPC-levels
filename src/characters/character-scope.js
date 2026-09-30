/** Local NPCs shadow reusable world cards with the same name in this chat. */
export function visibleCharacters(chat, world) {
    const localNames = new Set(chat.map(card => String(card.name || '').trim().toLowerCase()).filter(Boolean));
    return [...chat, ...world.filter(card =>
        !localNames.has(String(card.name || '').trim().toLowerCase()))];
}

/** New chat cards only adopt shared lore when the user explicitly chooses Sync. */
export function canAutoLinkLorebook(char, force = false) {
    return Boolean(char?.name) && (force || char.autoLinkLorebook !== false);
}
