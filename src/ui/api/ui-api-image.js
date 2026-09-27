import { POPUP_TYPE, POPUP_RESULT, Popup } from '../../../../../../popup.js';
import { triggerReprocess } from '../../chat/reprocess.js';
import { getRequestHeaders } from '../../../../../../../script.js';
import { pickAndProcessImage, makeActivatable } from '../../core/utils.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { LOG_PREFIX } from '../../core/constants.js';
import { generateCharacterImageLogic } from '../../api/api.js';

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

/**
 * Asks how the portrait should be generated, and against what reference.
 *
 * Referencing is Gemini-only: SillyTavern's generateGoogleImage sends a prompt and nothing
 * else, and the /sd command has no argument that carries an image. So the options are
 * hidden on that backend rather than offered and silently ignored.
 *
 * @param {object} char
 * @returns {Promise<{ references: string[] } | null>} null when cancelled.
 */
async function askGenerationMode(char) {
    const isGemini = getSettings().imageBackend === 'gemini';
    const own = Array.isArray(char.images) ? char.images.filter(Boolean) : [];

    if (!isGemini) {
        const ok = await Popup.show.confirm(
            `Generate an image for "${char.name || 'this character'}"?`,
            'The Image Generation extension cannot take a reference image, so this is drawn '
            + 'from the prompt alone.',
        );
        return ok ? { references: [] } : null;
    }

    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-gen-popup';

    const intro = document.createElement('p');
    intro.textContent = `How should "${char.name || 'this character'}" be drawn?`;
    wrap.append(intro);

    /** @type {string[]} */
    const chosen = [];
    let mode = own.length ? 'current' : 'scratch';

    const noteForCurrent = own.length
        ? 'Keeps the same face and outfit; pose and scene can still change.'
        : 'No image yet, so this falls back to from scratch.';

    const options = [
        { value: 'scratch', label: 'From scratch', note: 'The prompt only. A fresh interpretation every time.' },
        { value: 'current', label: 'Use the current image as reference', note: noteForCurrent },
        { value: 'pick', label: 'Choose reference images', note: "From this character's saved images, from disk, or both." },
    ];

    const pickArea = document.createElement('div');
    pickArea.className = 'sillynpc-genref-area';

    const updateTally = () => {
        const tally = pickArea.querySelector('.sillynpc-genref-count');
        if (!tally) return;
        tally.textContent = chosen.length
            ? `${chosen.length} reference image${chosen.length === 1 ? '' : 's'} selected.`
            : 'Nothing selected yet, so this would generate from scratch.';
    };

    const refresh = () => {
        pickArea.replaceChildren();
        if (mode !== 'pick') return;

        if (own.length) {
            const heading = document.createElement('div');
            heading.className = 'notes';
            heading.textContent = "This character's images, click to select:";
            pickArea.append(heading);

            const grid = document.createElement('div');
            grid.className = 'sillynpc-genref-grid';
            for (const src of own) {
                const cell = document.createElement('div');
                cell.className = 'sillynpc-genref-cell';
                const img = document.createElement('img');
                img.src = src;
                cell.append(img);
                makeActivatable(cell, { label: 'Use this reference image' });
                cell.addEventListener('click', () => {
                    const at = chosen.indexOf(src);
                    if (at >= 0) chosen.splice(at, 1);
                    else chosen.push(src);
                    cell.classList.toggle('selected', at < 0);
                    updateTally();
                });
                grid.append(cell);
            }
            pickArea.append(grid);
        }

        const upload = document.createElement('button');
        upload.type = 'button';
        upload.className = 'menu_button';
        upload.textContent = 'Add from disk';
        upload.addEventListener('click', async () => {
            const dataUrl = await pickAndProcessImage({ fullSize: true });
            if (dataUrl) {
                chosen.push(dataUrl);
                updateTally();
            }
        });
        pickArea.append(upload);

        const tally = document.createElement('div');
        tally.className = 'notes sillynpc-genref-count';
        pickArea.append(tally);
        updateTally();
    };

    const modes = document.createElement('div');
    modes.className = 'sillynpc-genmode-list';
    for (const option of options) {
        const row = document.createElement('label');
        row.className = 'sillynpc-genmode-row';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'sillynpc-genmode';
        radio.value = option.value;
        radio.checked = option.value === mode;
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            mode = option.value;
            refresh();
        });

        const label = document.createElement('strong');
        label.textContent = option.label;
        const note = document.createElement('small');
        note.className = 'notes';
        note.textContent = option.note;

        const text = document.createElement('span');
        text.append(label, document.createElement('br'), note);
        row.append(radio, text);
        modes.append(row);
    }

    wrap.append(modes, pickArea);
    refresh();

    const popup = new Popup(wrap, POPUP_TYPE.CONFIRM, '', { okButton: 'Generate', cancelButton: 'Cancel' });
    const result = await popup.show();
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;

    if (mode === 'scratch') return { references: [] };
    if (mode === 'current') return { references: char.imageUrl ? [char.imageUrl] : [] };
    return { references: chosen.slice() };
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
    const choice = await askGenerationMode(char);
    if (!choice) return;

    let imageUrl;
    try {
        toastr.info('Requesting image generation...', 'SillyNPC');
        imageUrl = await generateCharacterImageLogic(char, { referenceImages: choice.references });
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
