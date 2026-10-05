import { POPUP_TYPE, POPUP_RESULT, Popup } from '../../../../../../popup.js';
import { triggerReprocess } from '../../chat/reprocess.js';
import { getRequestHeaders } from '../../../../../../../script.js';
import { saveSettings } from '../../core/settings.js';
import { LOG_PREFIX } from '../../core/constants.js';
import { buildCharacterImagePrompt, generateCharacterImageLogic } from '../../api/api.js';

/**
 * Removes a generated image from disk.
 * @param {string} path
 */
async function deleteGeneratedImage(path) {
    if (!path || path.startsWith('data:')) return;
    try {
        await fetch('/api/images/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ path }),
        });
    } catch (err) {
        console.warn(LOG_PREFIX, 'Could not delete the discarded image:', err);
    }
}

/** Review and edit the exact prompt before spending an image request. */
async function askGenerationPrompt(char) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-gen-popup';
    const heading = document.createElement('h3');
    heading.textContent = `Generate an image for "${char.name || 'this character'}"`;
    const label = document.createElement('label');
    label.textContent = 'Image prompt';
    const prompt = document.createElement('textarea');
    prompt.className = 'text_pole sillynpc-image-prompt';
    prompt.rows = 12;
    prompt.style.width = '100%';
    prompt.setAttribute('aria-label', 'Image prompt');
    prompt.value = await buildCharacterImagePrompt(char);
    label.append(prompt);
    const note = document.createElement('p');
    note.className = 'notes';
    note.textContent = 'Edit the prompt for this request. SillyTavern Image Generation uses its configured provider and the standard portrait negative prompt; reference images are not supported by /imagine.';
    wrap.append(heading, label, note);
    const result = await new Popup(wrap, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Generate', cancelButton: 'Cancel',
        onClosing: popup => {
            if (popup.result === POPUP_RESULT.AFFIRMATIVE && !prompt.value.trim()) {
                toastr.warning('Enter an image prompt first.', 'SillyNPC');
                return false;
            }
            return true;
        },
    }).show();
    return result === POPUP_RESULT.AFFIRMATIVE ? prompt.value : null;
}

/**
 * Offers the finished image as use, keep or discard.
 *
 * Three outcomes need three buttons, which a confirm popup does not have, so the custom
 * buttons carry the answer and the popup's own result only tells us it closed. Dismissing
 * the popup any other way counts as discard, since an unwanted file is the thing worth
 * cleaning up.
 *
 * @param {string} url
 * @returns {Promise<'use'|'save'|'discard'>}
 */
async function askResultAction(url) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-gen-popup';

    const img = document.createElement('img');
    img.src = url;
    img.className = 'sillynpc-genresult-image';
    wrap.append(img);

    const note = document.createElement('p');
    note.className = 'notes';
    note.textContent = 'Use it as the portrait, keep it alongside the others, or delete it.';
    wrap.append(note);

    let answer = 'discard';
    const popup = new Popup(wrap, POPUP_TYPE.TEXT, '', {
        okButton: false,
        cancelButton: false,
        customButtons: [
            { text: 'Use as portrait', result: POPUP_RESULT.AFFIRMATIVE, action: () => { answer = 'use'; } },
            { text: 'Keep, do not use', result: POPUP_RESULT.AFFIRMATIVE, action: () => { answer = 'save'; } },
            { text: 'Discard', result: POPUP_RESULT.NEGATIVE, action: () => { answer = 'discard'; } },
        ],
    });
    await popup.show();
    return answer;
}

export async function generateCharacterImage(char, { onSave } = {}) {
    let imageUrl;
    try {
        const prompt = await askGenerationPrompt(char);
        if (prompt === null) return;
        toastr.info('Requesting image generation...', 'SillyNPC');
        imageUrl = await generateCharacterImageLogic(char, { prompt });
    } catch (err) {
        toastr.error(`Generation failed: ${err.message}`, 'SillyNPC');
        return;
    }

    const action = await askResultAction(imageUrl);

    if (action === 'discard') {
        await deleteGeneratedImage(imageUrl);
        toastr.info('Generated image discarded.', 'SillyNPC');
        return;
    }

    if (!Array.isArray(char.images)) char.images = [];
    if (!char.images.includes(imageUrl)) char.images.push(imageUrl);
    if (action === 'use') char.imageUrl = imageUrl;
    saveSettings();
    if (action === 'use') triggerReprocess();

    toastr.success(
        action === 'use' ? 'Character image updated.' : 'Image saved to this character.',
        'SillyNPC',
    );
    onSave?.();
}
