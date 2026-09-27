import { getRequestHeaders } from '../../../../../../script.js';

/** Every chat header, including metadata, without switching the open chat. */
export async function listChatHeaders() {
    const response = await fetch('/api/chats/recent', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ metadata: true }),
    });
    if (!response.ok) throw new Error(`Could not list chats (HTTP ${response.status}).`);
    const result = await response.json();
    if (!Array.isArray(result)) throw new Error('SillyTavern returned an invalid chat list.');
    return result;
}
