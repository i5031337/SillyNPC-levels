import { chat, getRequestHeaders } from '../../../../../script.js';
import { getAllCharacters, getLibraryCharacters } from './character-repository.js';
import { listChatHeaders } from './chat-listing.js';
import { chatNpcImagePaths } from './chat-npc-sources.js';
import { saveBase64AsFile } from '../../../../utils.js';
import { LOG_PREFIX, debugLog } from './constants.js';
import { forgetImageTags } from './image-tags.js';
import { claimFolder, sharedFolder } from './character-images.js';
import { triggerReprocess } from './reprocess.js';
import { getSettings, saveSettings } from './settings.js';
import { resolveImageFolder } from './utils.js';

/**
 * Writes a freshly generated image to disk and returns its served path.
 *
 * Generated images used to be stored as data: URIs directly in
 * extension_settings, so settings.json grew by the size of every portrait and was
 * rewritten on every save. This also makes the previously write-only
 * imageSaveRoute setting do something.
 *
 * Falls back to the original data URI if the upload fails, so image generation
 * never breaks just because the file could not be written.
 *
 * **A character's pictures go in their own folder**, which is what makes forty of them
 * manageable and what lets a filename say what a picture is *for* rather than who it
 * belongs to. A picture with no character - the fallback portrait pool - keeps the
 * configured route, which is what that setting means now.
 *
 * The name is a bare timestamp rather than the old `Varga_Elza_<ts>`. The folder already
 * says who, and a name of nothing but digits is guaranteed to parse to no value at all,
 * so a generated picture arrives untagged instead of claiming a meaning nobody gave it.
 * Renaming it to the value it shows is the whole of tagging.
 *
 * @param {string} dataUri
 * @param {object|string|null} owner The character, or anything else for the shared pool.
 * @returns {Promise<string>}
 */
export async function persistGeneratedImage(dataUri, owner) {
    const match = /^data:image\/([a-z0-9+.-]+);base64,(.+)$/i.exec(dataUri);
    if (!match) return dataUri;

    const [, rawFormat, base64] = match;
    const format = rawFormat.toLowerCase() === 'jpeg' ? 'jpg' : rawFormat.toLowerCase();

    const isCharacter = owner && typeof owner === 'object';
    // Claimed rather than merely read: writing for somebody is the moment their folder
    // stops following their name. See character-images.js.
    const folder = isCharacter ? claimFolder(owner) : '';

    const [where, fileName] = folder
        ? [folder, String(Date.now())]
        : [sharedFolder(), `${characterImagePrefix(
            typeof owner === 'string' ? owner : owner?.name)}${Date.now()}`];

    try {
        return await saveBase64AsFile(base64, where, fileName, format);
    } catch (err) {
        console.warn(LOG_PREFIX, 'Could not write generated image to disk; keeping inline data URI', err);
        return dataUri;
    }
}

/**
 * The filename prefix a character's generated images carry.
 *
 * One rule, used by both the writer and the scanner, because they have to agree exactly:
 * \w is [A-Za-z0-9_], so "Varga Elza" becomes "Varga_Elza" and accented letters are lost
 * too - "Dávid" is written as "D_vid" and "Agent Károly" as "Agent_K_roly". A scanner
 * that sanitised even slightly differently would match nothing for those characters and
 * report an honest-looking zero.
 *
 * @param {string} name
 * @returns {string}
 */
export function characterImagePrefix(name) {
    return `${(name || 'character').replace(/[^\w.-]+/g, '_')}_`;
}

/**
 * Adds images already on disk to the characters they belong to.
 *
 * Portraits were written to disk long before the extension kept a list of them, so a
 * character could have six pictures in the folder and know about one. This walks the
 * configured folder and hands each file to the character whose prefix it carries.
 *
 * Only finds what SillyNPC itself wrote. Images generated through SillyTavern's own
 * gallery are named after the character *card* - "The Dungeon Master_2026-05-28@...jpg" -
 * so they carry no clue about which SillyNPC character uses them, and are left alone
 * rather than guessed at.
 *
 * @returns {Promise<{ scanned: number, added: number, characters: number }>}
 */
export async function scanFolderForCharacterImages() {
    const folder = resolveImageFolder(getSettings().imageSaveRoute);

    let files = [];
    try {
        const response = await fetch('/api/images/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ folder, sortField: 'date', sortOrder: 'asc' }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        files = await response.json();
    } catch (err) {
        debugLog('Could not list the save folder', err);
        throw new Error(
            `Could not read user/images/${folder}. The folder may not exist yet, or no `
            + 'images have been generated into it.',
        );
    }

    if (!Array.isArray(files)) return { scanned: 0, added: 0, characters: 0 };

    const characters = getAllCharacters();
    // Longest prefix first, so "The Fae" cannot swallow a file belonging to "The Fae Queen".
    const byPrefix = characters
        .filter(char => char && char.name)
        .map(char => ({ char, prefix: characterImagePrefix(char.name) }))
        .sort((a, b) => b.prefix.length - a.prefix.length);

    let added = 0;
    const touched = new Set();

    for (const file of files) {
        if (typeof file !== 'string') continue;
        const match = byPrefix.find(entry => file.startsWith(entry.prefix));
        if (!match) continue;

        const path = `/user/images/${folder}/${file}`;
        const char = match.char;
        if (!Array.isArray(char.images)) char.images = [];
        if (char.images.includes(path)) continue;

        char.images.push(path);
        added++;
        touched.add(char.name);
    }

    if (added) saveSettings();
    return { scanned: files.length, added, characters: touched.size };
}

/**
 * Stores an image the user chose from disk, so it behaves like a generated one.
 *
 * Browsing used to assign the data URI straight to the character, which put the whole
 * image inside settings.json - the bloat writing to disk exists to avoid - and left it
 * out of the image list, so the arrows would step straight past it and it vanished.
 *
 * @param {object} char
 * @param {string} dataUri
 * @returns {Promise<string>} The stored path, or the original data URI if writing failed.
 */
export async function adoptImageForCharacter(char, dataUri) {
    const stored = await persistGeneratedImage(dataUri, char);
    if (!Array.isArray(char.images)) char.images = [];
    if (!char.images.includes(stored)) char.images.push(stored);
    char.imageUrl = stored;
    saveSettings();
    // The picture on every line this character speaks has just changed.
    triggerReprocess();
    return stored;
}

/**
 * Removes one image from a character, and from disk when nothing else uses it.
 *
 * The file is only unlinked when no other character points at it: sharing a portrait is
 * unusual but deleting one out from under a second character would be unrecoverable, and
 * an orphaned file costs nothing by comparison.
 *
 * @param {object} char
 * @param {string} path
 * @param {object} [options]
 * @param {boolean} [options.deleteFile=false] Erase the file too. Off by default so the
 *   destructive reading is never the one that happens by omission.
 * @returns {Promise<{ removed: boolean, deletedFile: boolean }>}
 */
export async function removeCharacterImage(char, path, { deleteFile = false } = {}) {
    if (!path || !Array.isArray(char.images)) return { removed: false, deletedFile: false };

    const at = char.images.indexOf(path);
    if (at >= 0) char.images.splice(at, 1);

    /* And whatever the picture was said to mean. The tag map is keyed by path, so an
       entry left behind would come back to life the moment the same file was adopted
       again - which is the ordinary case, since taking a picture off a character does
       not delete it. */
    forgetImageTags(char, path);

    // Step to whatever is left rather than leaving the character pointing at a gap.
    if (char.imageUrl === path) {
        char.imageUrl = char.images[Math.min(at, char.images.length - 1)] || '';
    }

    // The player's card holds images the same way a character's does, so it has to be
    // counted here too - otherwise erasing a portrait from a character could take the
    // file the player is using with it.
    const holders = [...getLibraryCharacters(), ...Object.values(getSettings().personaData || {})];
    let stillUsed = holders.some(
        other => other !== char && (other?.imageUrl === path
            || other?.defaultPortrait === path || (other?.images || []).includes(path)),
    );
    if (deleteFile && !stillUsed) {
        try {
            stillUsed = chatNpcImagePaths(await listChatHeaders()).has(path);
        } catch {
            // Without a complete reference list, leave the file in place.
            stillUsed = true;
        }
    }

    let deletedFile = false;
    if (deleteFile && !stillUsed && !path.startsWith('data:')) {
        try {
            const response = await fetch('/api/images/delete', {
                method: 'POST',
                headers: getRequestHeaders(),
                // The endpoint joins this to the user root, which is where the leading
                // slash the stored paths carry would take it somewhere else entirely.
                body: JSON.stringify({ path: path.replace(/^\//, '') }),
            });
            deletedFile = response.ok;
        } catch (err) {
            debugLog('Could not delete the image file', path, err);
        }
    }

    saveSettings();
    triggerReprocess();
    return { removed: at >= 0, deletedFile };
}

/**
 * Every image path anything still points at.
 *
 * Four holders, and missing any one of them turns a cleanup into data loss:
 *
 *   - a character's current portrait and its whole gallery;
 *   - a **persona's** record, which holds pictures the same way a character's does - the
 *     player's own portrait lives there, and forgetting it would delete the face on the HUD;
 *   - the fallback pool, whose entries belong to no character at all;
 *   - a card's `defaultPortrait`, the pool face written onto a card that has none of its own.
 *
 * Pure, and separated from the deleting for that reason: this is the half where a mistake
 * costs somebody their pictures, so it is the half worth testing.
 *
 * @param {object} [settings] Defaults to the live settings.
 * @returns {Set<string>} Paths, exactly as they are stored.
 */
export function referencedImagePaths(settings = getSettings()) {
    const keep = new Set();
    const add = (value) => {
        const path = String(value ?? '').trim();
        if (path) keep.add(path);
    };

    for (const holder of [...getLibraryCharacters(),
                          ...Object.values(settings.personaData || {})]) {
        add(holder?.imageUrl);
        add(holder?.defaultPortrait);
        for (const image of holder?.images || []) add(image);
    }
    for (const entry of settings.defaultImages || []) add(entry?.src);

    return keep;
}

async function allReferencedImagePaths() {
    const keep = referencedImagePaths();
    for (const path of chatNpcImagePaths(await listChatHeaders())) keep.add(path);
    return keep;
}

/**
 * Files in the save folder that nothing points at any more.
 *
 * Deleting a character has never deleted its pictures - deleteFile is opt-in throughout, so
 * that the destructive reading is never the one that happens by omission - so they
 * accumulate. This finds them; it does not remove anything.
 *
 * @returns {Promise<{ folder: string, files: string[], scanned: number }>}
 */
export async function findOrphanedImages() {
    const folder = resolveImageFolder(getSettings().imageSaveRoute);

    let files = [];
    try {
        const response = await fetch('/api/images/list', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ folder, sortField: 'date', sortOrder: 'asc' }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        files = await response.json();
    } catch (err) {
        debugLog('Could not list the save folder', err);
        throw new Error(`Could not read user/images/${folder}.`);
    }
    if (!Array.isArray(files)) return { folder, files: [], scanned: 0 };

    const keep = await allReferencedImagePaths();
    const orphans = files
        .filter(file => typeof file === 'string')
        .map(file => `/user/images/${folder}/${file}`)
        .filter(path => !keep.has(path));

    return { folder, files: orphans, scanned: files.length };
}

/**
 * Deletes the given image files.
 *
 * Takes the list rather than finding it again, so what is deleted is exactly what the user
 * was shown and agreed to - a second scan between the question and the answer could pick up
 * a portrait generated in between.
 *
 * @param {string[]} paths
 * @returns {Promise<{ deleted: number, failed: number }>}
 */
export async function deleteImageFiles(paths) {
    let deleted = 0;
    let failed = 0;

    // Recheck at deletion time: another chat may have acquired a portrait since the scan.
    const keep = await allReferencedImagePaths();

    for (const path of paths || []) {
        if (keep.has(path)) { failed += 1; continue; }
        try {
            const response = await fetch('/api/images/delete', {
                method: 'POST',
                headers: getRequestHeaders(),
                // Leading slash removed: the endpoint joins this to the user root.
                body: JSON.stringify({ path: String(path).replace(/^\//, '') }),
            });
            if (response.ok) deleted += 1; else failed += 1;
        } catch (err) {
            debugLog('Could not delete', path, err);
            failed += 1;
        }
    }
    return { deleted, failed };
}

