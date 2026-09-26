export const CHAT_NPCS_KEY = 'sillynpc_npcs';

export function chatSourceKey(header) {
    return [header.group || '', header.avatar || '', header.file_id || header.file_name || ''].join(':');
}

/** Collect every independent chat NPC assigned to a System. */
export function chatNpcSources(headers, systemName) {
    const found = [];
    const seen = new Set();
    for (const header of headers || []) {
        const metadata = header?.chat_metadata;
        if (metadata?.sillynpc_system !== systemName) continue;
        const sourceChat = chatSourceKey(header);
        for (const char of Array.isArray(metadata[CHAT_NPCS_KEY]) ? metadata[CHAT_NPCS_KEY] : []) {
            if (!char?.id) continue;
            const identity = `${sourceChat}:${char.id}`;
            if (seen.has(identity)) continue;
            seen.add(identity);
            found.push({ char, sourceChat });
        }
    }
    return found;
}

export function chatNpcImagePaths(headers) {
    const paths = new Set();
    for (const header of headers || []) {
        for (const card of Array.isArray(header?.chat_metadata?.[CHAT_NPCS_KEY])
            ? header.chat_metadata[CHAT_NPCS_KEY] : []) {
            for (const value of [card?.imageUrl, card?.defaultPortrait, ...(card?.images || [])]) {
                if (typeof value === 'string' && value) paths.add(value);
            }
        }
    }
    return paths;
}
