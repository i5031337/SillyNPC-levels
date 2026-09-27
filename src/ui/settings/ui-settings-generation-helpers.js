import { getSettings, saveSettings } from '../../core/settings.js';
import { resolveImageFolder } from '../../core/utils.js';
import { world_names } from '../../../../../../world-info.js';
import { extension_settings } from '../../../../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../popup.js';
import { debugLog } from '../../core/constants.js';
import { buildLoreExcerpt, resolvePortraitShape, getLastLoreConnection, resolveImageSecretId } from '../../api/api.js';
import { getSecretLabelById } from '../../../../../../secrets.js';
import { getRequestHeaders } from '../../../../../../../script.js';
import { getContext } from '../../../../../../extensions.js';

export async function listUserImageFolders() {
    try {
        const response = await fetch('/api/images/folders', {
            method: 'POST',
            headers: getRequestHeaders(),
        });
        if (!response.ok) return [];
        const folders = await response.json();
        return Array.isArray(folders) ? folders.filter(f => typeof f === 'string') : [];
    } catch (err) {
        debugLog('Could not list image folders', err);
        return [];
    }
}

/**
 * Asks which folder to save into, offering the ones that exist.
 *
 * The button used to open a bare text prompt seeded with the value the field already
 * showed, which told the user nothing they did not already know. Listing the real
 * directories is the difference between a browse button and a rename box.
 *
 * A new name is still allowed - the folder is created on first write - so the list is an
 * offer, not a restriction.
 *
 * @param {string[]} folders
 * @param {string} current
 * @returns {Promise<string|null>} The chosen folder, or null if cancelled.
 */
export async function pickImageFolder(folders, current) {
    if (!folders.length) {
        const typed = await Popup.show.input(
            'Generated Image Folder',
            'No folders exist under user/images/ yet. Name one to create:',
            current,
        );
        return typed?.trim() || null;
    }

    const wrap = document.createElement('div');
    const label = document.createElement('p');
    label.textContent = 'Choose a folder under user/images/, or type a new name to create one.';

    const list = document.createElement('select');
    list.className = 'text_pole';
    list.size = Math.min(8, folders.length + 1);
    list.style.cssText = 'width:100%; margin:8px 0;';

    const resolvedCurrent = resolveImageFolder(current);
    for (const folder of folders) {
        const option = document.createElement('option');
        option.value = folder;
        option.textContent = folder;
        if (folder === resolvedCurrent) option.selected = true;
        list.append(option);
    }

    const typed = document.createElement('input');
    typed.type = 'text';
    typed.className = 'text_pole';
    typed.placeholder = 'or type a new folder name';
    typed.style.cssText = 'width:100%;';

    wrap.append(label, list, typed);

    const popup = new Popup(wrap, POPUP_TYPE.CONFIRM, "", { okButton: "Use folder", cancelButton: "Cancel" });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;

    // A typed name wins over the selection: someone who took the trouble to type meant it.
    return typed.value.trim() || list.value || null;
}
/**
 * Which connection the last lore generation actually used.
 *
 * Choosing a connection here has never changed what the chat uses - the request carries the
 * profile rather than selecting it - but that was only ever arguable from the code, never
 * checkable from the UI. This turns the next such question into a fact.
 */
export function buildLastLoreConnectionNote() {
    const note = document.createElement('small');
    note.className = 'notes';
    note.style.cssText = 'display:block; margin:-6px 0 10px;';

    const last = getLastLoreConnection();
    note.textContent = last
        ? `Last lore request used: ${last.label}. Your chat's own connection is never changed by this.`
        : "No lore generated yet this session. Your chat's own connection is never changed by this.";
    return note;
}

/**
 * What one lore generation would cost, right now, on the open chat.
 *
 * The setting is in characters, the chat is in messages and the bill is in tokens, and no
 * amount of help text bridges those three. Measuring the open chat does: it turns "200000"
 * into "83 of 469 messages, ~49,900 tokens", which is the number the user is actually
 * deciding about.
 *
 * Uses buildLoreExcerpt so this can never disagree with what is really sent - it is the
 * same function, on the same chat, with the same settings.
 *
 * @param {HTMLElement} target
 */
export function updateExcerptReadout(target) {
    const chat = getContext()?.chat;
    if (!Array.isArray(chat) || chat.length === 0) {
        target.textContent = 'Open a chat to see what this costs.';
        return;
    }

    const { text, used, available } = buildLoreExcerpt(chat);
    // Four characters per token is the rule of thumb the setting's own help uses; it is
    // an estimate and is labelled as one rather than dressed up as a count.
    const tokens = Math.round(text.length / 4);
    target.textContent = `Right now: ${used} of ${available} messages, `
        + `${text.length.toLocaleString()} characters, ~${tokens.toLocaleString()} tokens per request.`;
}

/**
 * Where portraits will actually be drawn, read live.
 *
 * Both questions this answers were ones the settings could not: whose API the Gemini
 * option uses, and what the /sd option is currently pointed at. Read from SillyTavern's
 * own Image Generation settings rather than described in prose, because prose goes stale
 * and the answer changes whenever that extension is reconfigured.
 */
export function buildBackendDestinationNote() {
    const note = document.createElement('small');
    note.className = 'notes';
    note.style.cssText = 'display:block; margin:-6px 0 10px;';

    const settings = getSettings();
    if (settings.imageBackend === 'gemini') {
        // Naming the key is the fact that was missing. Two connection profiles that
        // pin the same secret look completely different by name and identical here,
        // which is the failure that took an evening to find. The label carries a
        // masked value from SillyTavern, never the key itself.
        const secretId = resolveImageSecretId();
        const keyLabel = secretId ? getSecretLabelById(secretId) : '';
        const whichKey = keyLabel
            ? `Billed to: ${keyLabel}.`
            : "Billed to whichever Google key is active - the same one your chat uses.";
        note.textContent = "Sends to SillyTavern's Google AI Studio connection, using the "
            + `key saved there — not whichever API you are chatting with. Model: ${settings.geminiImageModel}, `
            + `aspect ratio ${resolvePortraitShape().gemini}. ${whichKey}`;
        return note;
    }

    const sd = extension_settings.sd || {};
    const where = sd.source
        ? `${sd.source}${sd.model ? ` / ${sd.model}` : ''}`
        : 'not configured yet';

    // The resolution line is the one that was missing from both UIs. The pixels we send
    // do not survive every source - Google converts them to the nearest ratio it accepts
    // and ignores the rest - so this says what is sent, and the shape control above says
    // what shape that works out to.
    const { pixels } = resolvePortraitShape();
    const size = pixels
        ? `Sent at ${pixels.width}x${pixels.height}, overriding its own Resolution setting`
        : `Using its own Resolution setting${sd.width && sd.height ? ` (${sd.width}x${sd.height})` : ''}`;

    note.textContent = `Sends to the Image Generation extension, currently set to: ${where}. `
        + `${size}. Its own prompt prefix and negative prompt are added to yours. `
        + 'The key is whichever SillyTavern has active for that source; SillyNPC cannot choose it on this path.';
    return note;
}

export function buildWorldInfoScannerSettings() {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    
    const label = document.createElement('label');
    label.className = 'sillynpc-setting-row';
    label.style.fontWeight = 'bold';
    label.textContent = 'World Info to Scan';
    
    const list = document.createElement('div');
    list.className = 'sillynpc-world-list';
    list.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:6px';
    
    const selected = getSettings().scanLorebooks || [];
    (Array.isArray(world_names) ? world_names : []).forEach(name => {
        const item = document.createElement('label');
        item.className = 'checkbox_label';
        
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = selected.includes(name);
        input.addEventListener('change', (e) => {
            if (e.target.checked) { if (!selected.includes(name)) selected.push(name); }
            else { const i = selected.indexOf(name); if (i !== -1) selected.splice(i, 1); }
            getSettings().scanLorebooks = selected; saveSettings();
        });
        
        item.append(input, ` ${name}`);
        list.append(item);
    });
    
    wrap.append(label, list);
    return wrap;
}
