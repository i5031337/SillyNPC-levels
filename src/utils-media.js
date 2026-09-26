import { LOG_PREFIX, IMAGE_MAX_DIMENSION, IMAGE_PORTRAIT_MAX_DIMENSION, IMAGE_JPEG_QUALITY, debugLog } from './constants.js';
import { getContext } from '../../../../st-context.js';
import { getSecretLabelById, resolveSecretKey, secret_state } from '../../../../secrets.js';

/**
 * Which connection, model and key the *chat* is about to use.
 *
 * SillyTavern never logs this, and a normal generation sends no secret_id at all - the
 * server falls back to whichever secret is marked active - so there was no way to compare
 * the chat against SillyNPC's own requests. Seeing one without the other is what made two
 * profiles that shared a key look like they were separated.
 *
 * Read the same way the server resolves it: the active entry for whatever secret key the
 * current API maps to. The value SillyTavern hands the browser is already masked.
 *
 * @returns {string}
 */
export function describeChatConnection() {
    const context = getContext();
    const source = context?.chatCompletionSettings?.chat_completion_source || context?.mainApi || 'unknown API';
    let model = '';
    try { model = context?.getChatCompletionModel?.() || ''; } catch { model = ''; }

    const secretKey = resolveSecretKey();
    const saved = secretKey ? secret_state?.[secretKey] : null;
    const active = Array.isArray(saved) ? saved.find(s => s?.active) : null;
    const key = active
        ? `${active.label}${active.value ? ` (${active.value})` : ''}`
        : 'none saved';

    return `Chat -> ${source}${model ? ` / ${model}` : ''}, key: ${key}`;
}

/**
 * Which connection, model and API key a request will actually use.
 *
 * Written for the console, because the panel could only ever say what the *next* request
 * would do. A user running two Google profiles to separate chat from lore spent an evening
 * on it: both profiles pinned the same secret-id, so choosing between them changed the
 * model and nothing else, and nothing anywhere said so.
 *
 * The key label comes from SillyTavern already masked - it is what the Connection Manager
 * shows in its own profile details - so the real key never reaches the console.
 *
 * @param {string} profileId
 * @param {object} [options]
 * @param {boolean} [options.includeModel=true] Portraits take only the key from their
 *   profile - the image model is chosen separately, and naming the profile's text model
 *   beside it reads as two models for one request.
 * @returns {string}
 */
export function describeConnection(profileId, { includeModel = true } = {}) {
    if (!profileId) return 'main API (same as chat), key: whichever is active';

    const profiles = getContext()?.extensionSettings?.connectionManager?.profiles;
    const profile = Array.isArray(profiles) ? profiles.find(p => p?.id === profileId) : null;
    // A profile deleted since it was chosen is the case most likely to look like a bug, so
    // it is named rather than quietly reported as the main API.
    if (!profile) return `profile ${profileId} is missing, so the main API was used`;

    const secretId = profile['secret-id'];
    const keyLabel = secretId ? getSecretLabelById(secretId) : '';
    const key = keyLabel || (secretId ? secretId : 'whichever is active');
    return includeModel
        ? `${profile.name || profileId}${profile.model ? ` / ${profile.model}` : ''}, key: ${key}`
        : `key: ${key} (from "${profile.name || profileId}")`;
}


export function makeId() {
    return (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

/**
 * Load a File into an HTMLImageElement.
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = String(reader.result);
        };
        reader.readAsDataURL(file);
    });
}

/**
 * The rendition sizes a portrait is kept at, so a few pixels of difference do not mint a
 * new copy of the same picture.
 *
 * Rounded up rather than to nearest: a rendition smaller than the box it fills is the one
 * failure this whole mechanism exists to avoid, and the next step up costs memory rather
 * than quality. Above the largest step the original is used as it is - by then it is being
 * drawn near its own size and there is nothing to gain.
 *
 * @param {number} wanted Pixels the picture's shorter side must reach, devicePixelRatio included.
 * @returns {number} The step to render at, or 0 to mean "use the original".
 */
export function renditionStep(wanted) {
    const STEPS = [64, 96, 128, 192, 256, 384, 512, 768];
    const needed = Number(wanted);
    if (!Number.isFinite(needed) || needed <= 0) return 0;
    return STEPS.find(step => step >= needed) ?? 0;
}

/**
 * The size to reduce a picture to so that it still covers a frame `step` pixels across.
 *
 * The frame crops (object-fit: cover), so it is the picture's *shorter* side that has to
 * reach across it. This used to fit the longer side to the step instead: an 864x1184
 * portrait in a circle 166 pixels across came out 140x192, and its 140-pixel width was
 * stretched back up to 166 - the soft, grainy HUD portrait that kept coming back.
 *
 * @returns {{ width: number, height: number } | null} null when the picture is already
 *   small enough that reducing it would only lose detail.
 */
export function renditionSize(naturalWidth, naturalHeight, step) {
    const w = Number(naturalWidth), h = Number(naturalHeight), target = Number(step);
    if (!(w > 0) || !(h > 0) || !(target > 0)) return null;
    const shorter = Math.min(w, h);
    if (shorter <= target) return null;
    const scale = target / shorter;
    return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Reduces a picture in halving steps, then once more to the exact size.
 *
 * One jump from 864 pixels to 140 skips most of the picture: the browser samples a few
 * pixels per output pixel and the rest are lost, which is what grain looks like. Halving
 * each time keeps every step a gentle one.
 *
 * @returns {string} A PNG data URI - a portrait may have a transparent background, and a
 *   JPEG would put a black rectangle behind the character.
 */
export function reduceInSteps(img, width, height) {
    let source = img;
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    const draw = (from, toW, toH) => {
        const canvas = document.createElement('canvas');
        canvas.width = toW;
        canvas.height = toH;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(from, 0, 0, toW, toH);
        return canvas;
    };
    while (w / 2 >= width && h / 2 >= height) {
        w = Math.round(w / 2);
        h = Math.round(h / 2);
        source = draw(source, w, h);
    }
    return draw(source, width, height).toDataURL('image/png');
}

/** One rendition per source and size. Portraits are redrawn constantly; the work is not. */
const renditions = new Map();

/**
 * The same picture, already reduced to about the size it will be drawn at.
 *
 * The floating HUD draws an 864x1184 portrait in a circle a hundred pixels across and it
 * came out visibly coarse, while the same file in the chat and on the character cards did
 * not. Enlarged in place it was crisp, so the file was never the problem - only what the
 * browser made of it on the way down to that size. Handing it a picture that is already
 * near the right size takes that step out of the browser's hands.
 *
 * Failure returns the original URL rather than throwing. A portrait that is merely coarse
 * is worth far more than an empty frame, and a picture served from somewhere that taints a
 * canvas would otherwise take the HUD out entirely.
 *
 * @param {string} url
 * @param {number} pixels The frame's larger side in device pixels (devicePixelRatio included):
 *   what the picture's shorter side has to cover.
 * @returns {Promise<string>} A data URI, or `url` unchanged.
 */
export async function portraitRendition(url, pixels) {
    const source = String(url ?? '');
    const step = renditionStep(pixels);
    if (!source || !step || source.startsWith('data:')) return source;

    const key = `${source}@${step}`;
    if (renditions.has(key)) return renditions.get(key);

    const made = (async () => {
        try {
            const img = await new Promise((resolve, reject) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => reject(new Error('could not load'));
                el.src = source;
            });
            const size = renditionSize(img.naturalWidth, img.naturalHeight, step);
            // Already small enough: reducing it further would only lose detail.
            if (!size) return source;
            return reduceInSteps(img, size.width, size.height);
        } catch (err) {
            debugLog('Could not size the portrait down; using it as it is', source, err);
            return source;
        }
    })();

    renditions.set(key, made);
    return made;
}

/**
 * Downscale an image to fit within IMAGE_MAX_DIMENSION on its longer side.
 * Uses PNG for files that might have transparency, otherwise JPEG for size.
 * @param {HTMLImageElement} img
 * @param {boolean} usePng
 * @returns {string} data URI
 */
function downscaleImage(img, usePng = false, max = IMAGE_MAX_DIMENSION) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    if (usePng) {
        return canvas.toDataURL('image/png');
    }
    return canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY);
}

/**
 * @param {object} [options]
 * @param {boolean} [options.fullSize=false] Keep portrait resolution rather than shrinking
 *   to the thumbnail cap. For images written to disk, where the small cap only ever cost
 *   quality; leave it off for anything stored inline in settings.json.
 */
export async function pickAndProcessImage({ fullSize = false } = {}) {
    const picked = await pickAndProcessImages({ fullSize, multiple: false });
    return picked[0] ?? null;
}

/**
 * The same, for as many files as the user cares to choose at once.
 *
 * Filling a pool of fallback faces one file at a time is six trips through the file
 * dialog to do one thing.
 *
 * One bad file does not lose the rest: each is read on its own and the ones that fail are
 * counted rather than thrown, since a folder of pictures may well hold something that is
 * not one.
 *
 * @param {object} [options]
 * @param {boolean} [options.fullSize=false] See pickAndProcessImage.
 * @param {boolean} [options.multiple=true]
 * @returns {Promise<string[]>} Data URIs, in the order chosen.
 */
export async function pickAndProcessImages({ fullSize = false, multiple = true } = {}) {
    return new Promise(resolve => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        if (multiple) fileInput.multiple = true;
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', async () => {
            const files = Array.from(fileInput.files || []);
            fileInput.remove();
            if (!files.length) return resolve([]);

            const cap = fullSize ? IMAGE_PORTRAIT_MAX_DIMENSION : IMAGE_MAX_DIMENSION;
            const out = [];
            let failed = 0;
            for (const file of files) {
                try {
                    const img = await loadImageFromFile(file);
                    const usePng = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
                    out.push(downscaleImage(img, usePng, cap));
                } catch (err) {
                    failed++;
                    console.error(LOG_PREFIX, 'image load failed', file?.name, err);
                }
            }
            if (failed) {
                toastr.error(
                    files.length === 1 ? 'Could not read that image.'
                        : `Could not read ${failed} of ${files.length} images.`,
                    'SillyNPC');
            }
            resolve(out);
        }, { once: true });
        document.body.appendChild(fileInput);
        fileInput.click();
    });
}

/**
 * The single folder name a configured save route collapses to.
 *
 * The upload route sanitises this into one segment under user/images/, so anything
 * path-like loses all but its last part: "images/sillynpc" is written to
 * user/images/sillynpc, not user/images/images/sillynpc.
 *
 * One rule, shared by everything that touches the setting - the writer, the scanner that
 * has to look in the same place, the panel that reports the destination, and the
 * normaliser that cleans what is stored. Here rather than in api.js because settings.js
 * needs it too and cannot import api.js, which imports settings.js.
 *
 * @param {string} configured
 * @returns {string}
 */
export function resolveImageFolder(configured) {
    return String(configured || '').split(/[\\/]/).map(part => part.trim()).filter(Boolean).pop() || 'sillynpc';
}

/**
 * Where a configured save route will actually put a portrait, said out loud.
 *
 * Separate from the panel so the wording can be checked without building one, and because
 * showing the answer is not the same as saying the answer differs from the question:
 * someone typing a full path has the wrong idea about this field, and a grey line quietly
 * showing a different folder does not correct one.
 *
 * @param {string} configured
 * @returns {string}
 */
export function describeSaveDestination(configured) {
    const typed = String(configured ?? '').trim();
    const folder = resolveImageFolder(configured);
    const where = folder
        ? `Saved to: user/images/${folder}/`
        : 'Saved to: user/images/ (no folder set)';
    // Only when it was not taken as written. Saying it every time teaches people to stop
    // reading the line.
    return typed && typed !== folder
        ? `${where} — not a path: only the last part is used.`
        : where;
}

/**
 * Moves one entry of a list up or down, in place.
 *
 * The order of a list in System Builder is the order everything downstream shows: the
 * tracker renders fields in it, the character page lists overrides in it, the extraction
 * schema and prompt name them in it. So moving the entry is the whole of reordering -
 * there is nothing else to keep in step.
 *
 * One rule rather than a swap written out at each control: collections had a pair of
 * buttons with the swap inline, and adding the same pair to stat rows and to collection
 * fields would have made four copies of it to keep right.
 *
 * @param {Array} list Mutated in place.
 * @param {number} index
 * @param {number} delta -1 for up, 1 for down.
 * @returns {boolean} False when the move would fall off either end, so a caller can leave
 *   its control disabled rather than offering a press that does nothing.
 */
export function moveInList(list, index, delta) {
    if (!Array.isArray(list)) return false;
    const from = Number(index);
    const to = from + Number(delta);
    if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
    if (from < 0 || from >= list.length || to < 0 || to >= list.length) return false;
    // Swapping an entry with itself is not a move, and saying it was would have the
    // caller save the settings and redraw the whole editor for nothing.
    if (from === to) return false;

    [list[from], list[to]] = [list[to], list[from]];
    return true;
}

/**
 * Hands the browser a file to save.
 *
 * One copy, where there were three - the manage popup's export, the system exporter and the
 * character transfer each built the same eight lines. They also shared two habits that only
 * Chrome tolerates, and SillyTavern runs in Firefox too: the anchor was never added to the
 * document, which Firefox has historically required before a synthetic click dispatches, and
 * the object URL was revoked on the very next line, which can abort a download that has not
 * started. Attached, clicked, removed, and revoked a tick later.
 *
 * @param {*} payload Serialised as pretty JSON unless a string is passed.
 * @param {string} fileName
 * @param {string} [type]
 */
export function offerDownload(payload, fileName, type = 'application/json') {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type }));

    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Deferred, not immediate: revoking synchronously can cancel the save.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

