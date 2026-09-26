import { getRequestHeaders } from '../../../../../script.js';
import { debugLog } from './constants.js';
import { getSettings, saveSettings } from './settings.js';
import { getLibraryCharacters } from './character-repository.js';
import { folderNameFor, folderFor, claimFolder, sharedFolder } from './character-images.js';

const IMAGES_AND_VIDEOS = 0b011;

/* ─── Moving what is already on disk ──────────────────────────────────────── */

/**
 * Every path that belongs to something other than a character.
 *
 * The fallback portrait pool and the personas share the flat folder, and a file can be in
 * two places at once - a character's gallery and the pool both pointing at one picture.
 * Moving such a file would fix one and break the other, so it is left exactly where it is
 * and the character keeps pointing at it there.
 *
 * Personas are left alone wholesale: a persona record has no name to make a folder from,
 * and the player has one avatar rather than forty.
 *
 * @returns {Set<string>}
 */
function pathsSpokenForElsewhere() {
    const settings = getSettings();
    const held = new Set();

    for (const entry of settings.defaultImages || []) {
        if (entry?.src) held.add(entry.src);
    }
    for (const persona of Object.values(settings.personaData || {})) {
        if (persona?.imageUrl) held.add(persona.imageUrl);
        for (const path of persona?.images || []) held.add(path);
    }
    return held;
}

/** A file already on disk, as the base64 the upload endpoint wants. */
async function readAsBase64(path) {
    const response = await fetch(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const dataUri = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
        reader.readAsDataURL(blob);
    });

    const comma = dataUri.indexOf(',');
    if (comma < 0) throw new Error('not a data URI');
    return dataUri.slice(comma + 1);
}

/**
 * Whether a file is really there and really a picture or a video, before the original is
 * deleted. Video because a location's background can be one, and moving a folder moves
 * everything in it.
 */
async function copyLanded(path) {
    try {
        const response = await fetch(path, { cache: 'no-store' });
        if (!response.ok) return false;
        const blob = await response.blob();
        const type = String(blob.type || '');
        return blob.size > 0 && (type.startsWith('image/') || type.startsWith('video/'));
    } catch {
        return false;
    }
}


/** The file names in a folder, pictures and videos both. */
async function listFolder(folder) {
    const response = await fetch('/api/images/list', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ folder, type: IMAGES_AND_VIDEOS, sortField: 'name', sortOrder: 'asc' }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} listing ${folder}`);
    const files = await response.json();
    return Array.isArray(files) ? files : [];
}

/**
 * The name a folder really has on disk, when one exists under the same letters in any case.
 *
 * Windows ignores case in folder names, so asking for "Location - House Inside" when
 * "Location - House inside" exists opens the one that exists - and SillyTavern can neither
 * rename a folder nor delete an empty one, so its capitals can never be changed from here.
 * Using the name as it really is keeps every stored path in agreement with the disk.
 *
 * @returns {Promise<string>} '' when there is no such folder, or the listing fails.
 */
async function folderOnDisk(name) {
    try {
        const response = await fetch('/api/images/folders', { method: 'POST', headers: getRequestHeaders() });
        if (!response.ok) return '';
        const folders = await response.json();
        const wanted = String(name).toLowerCase();
        return (Array.isArray(folders) ? folders : []).find(f => String(f).toLowerCase() === wanted) ?? '';
    } catch {
        return '';
    }
}

/**
 * Moves everything in a card's folder to the folder for a new name, and re-points the card.
 *
 * SillyTavern has no move or rename for folders, so this is the migration's own sequence
 * file by file: **copy, confirm the copy reads back, re-point, then delete the original.**
 * An interruption never leaves a card pointing at a file that is not there. The old folder
 * itself stays behind, empty - SillyTavern cannot delete a folder.
 *
 * It refuses, and changes nothing, when moving would take somebody else's pictures or
 * pour these into somebody else's:
 * - another card uses the old folder too (two characters that once shared a name);
 * - another card already uses the new folder;
 * - the new folder already has files in it.
 *
 * Works on anything shaped like a card - `imageFolder`, `images`, `imageUrl`, `imageTags` -
 * so a location moves the same way a character does.
 *
 * @param {object} owner
 * @param {string} name The name the folder should now follow.
 * @param {object} [options]
 * @param {string} [options.from] The folder before the rename, when the card's name has
 *   already changed and it never stored one - otherwise it would be read from the new name.
 * @param {string} [options.prefix] Put before the name, as locations do.
 * @param {object[]} [options.others] Every other card with a folder. Characters by default.
 * @param {() => void} [options.save] Saves whatever the owner lives in.
 * @returns {Promise<{ folder: string, moved: number, left: string[], refused: string, note: string }>}
 *   `note` says when the folder could not take the new name's capitals.
 */
export async function moveFolder(owner, name, options = {}) {
    const save = options.save ?? saveSettings;
    const wanted = folderNameFor(`${options.prefix ?? ''}${name ?? ''}`);
    const from = folderNameFor(options.from) || folderFor(owner);
    const result = { folder: from, moved: 0, left: [], refused: '', note: '' };
    if (!owner || !wanted) return { ...result, refused: 'no usable name' };

    const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
    const capitalsNote = (kept) => `the folder is still called "${kept}": a folder of that name in different capitals `
        + 'already exists, and SillyTavern cannot rename folders. Rename or delete it by hand to change the capitals.';

    /* A change of capitals only. Windows sees one folder, so there is nothing to move - and
       the stored folder must stay the name the disk has, or every picture path and tag stored
       under it stops matching what the folder lists. */
    if (!from || same(from, wanted)) {
        const kept = from || (await folderOnDisk(wanted)) || wanted;
        owner.imageFolder = kept;
        save();
        return { ...result, folder: kept, note: kept === wanted ? '' : capitalsNote(kept) };
    }

    // An existing folder under other capitals is the one Windows will open; use its real name.
    const target = (await folderOnDisk(wanted)) || wanted;
    if (target !== wanted) result.note = capitalsNote(target);

    const others = (options.others ?? getLibraryCharacters()).filter(o => o && o !== owner);
    if (others.some(o => same(folderFor(o), from))) {
        return { ...result, refused: `"${from}" is also used by someone else, so it stays where it is` };
    }
    if (others.some(o => same(folderFor(o), target))) {
        return { ...result, refused: `"${target}" already belongs to someone else` };
    }
    if ((await listFolder(target)).length > 0) {
        return { ...result, refused: `"${target}" already has files in it` };
    }

    const files = await listFolder(from);
    for (const file of files) {
        try {
            if (await moveOne(owner, `/user/images/${from}/${file}`, target)) result.moved++;
        } catch (err) {
            debugLog(`Could not move ${file} to ${target}`, err);
            result.left.push(file);
        }
    }

    /* The new folder from here on, even if a file stayed behind: the name has changed, and
       new pictures belong under it. What was left is reported, so it can be moved by hand. */
    owner.imageFolder = target;
    save();
    return { ...result, folder: target };
}

/**
 * Moves one picture into its character's folder, and re-points everything that named it.
 *
 * **Copy, confirm, re-point, and only then delete.** In that order, and the order is the
 * whole safety of this: an interruption at any point leaves a picture that exists in at
 * least one place and a card that points at one that exists. The worst outcome is a file
 * left behind in the old folder, which costs disk and nothing else.
 *
 * @returns {Promise<string>} The new path, or '' when nothing moved.
 */
async function moveOne(char, oldPath, folder) {
    const file = oldPath.split('/').pop();
    if (!file) return '';

    const dot = file.lastIndexOf('.');
    const stem = dot > 0 ? file.slice(0, dot) : file;
    const format = dot > 0 ? file.slice(dot + 1).toLowerCase() : 'png';

    const base64 = await readAsBase64(oldPath);

    /* The endpoint directly rather than SillyTavern's saveBase64AsFile wrapper.
     *
     * That wrapper rewrites dots in the name into underscores, which is right for a name
     * it is about to append an extension to and wrong for one that already survived a
     * rename by hand - and a picture called `wounded.rain.png` is exactly the shape this
     * whole feature encourages. Moving a file must not quietly rename it. */
    const upload = await fetch('/api/images/upload', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ image: base64, format, ch_name: folder, filename: stem }),
    });
    if (!upload.ok) throw new Error(`HTTP ${upload.status} writing ${file}`);
    const newPath = (await upload.json())?.path;

    if (!newPath || !(await copyLanded(newPath))) {
        throw new Error(`the copy of ${file} could not be read back`);
    }

    // Every record that named the old path, including the tag map keyed by it.
    char.images = (char.images || []).map(p => (p === oldPath ? newPath : p));
    if (char.imageUrl === oldPath) char.imageUrl = newPath;
    if (char.imageTags?.[oldPath]) {
        char.imageTags[newPath] = char.imageTags[oldPath];
        delete char.imageTags[oldPath];
    }

    try {
        await fetch('/api/images/delete', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ path: oldPath.replace(/^\//, '') }),
        });
    } catch (err) {
        // The move succeeded; the tidying did not. Nothing points at the old file now.
        debugLog(`Could not remove ${oldPath} after copying it`, err);
    }

    return newPath;
}

/**
 * Puts every character's pictures into their own folder, once.
 *
 * Runs on load rather than behind a button, which was asked for with the risk stated. What
 * makes that survivable is that it is **resumable and never destructive in the wrong
 * order**: each picture is copied, read back, re-pointed and only then deleted, and the
 * settings are saved after each character. A failure stops the pass with everything before
 * it done and everything after it untouched, and the next load carries on. Nothing is ever
 * in a state where a card points at a file that is not there.
 *
 * Filenames are kept exactly as they are. Tidier names would be nice and are one more
 * thing to go wrong in a pass that is already moving every picture in the library; the
 * point of the folders is that a *new* name can now say what a picture is for.
 *
 * @returns {Promise<{ moved: number, characters: number, failed: string }>}
 */
export async function migrateImagesToFolders() {
    const settings = getSettings();
    if (settings.imagesFoldered) return { moved: 0, characters: 0, failed: '' };

    const from = `/user/images/${sharedFolder()}/`;
    const held = pathsSpokenForElsewhere();
    let moved = 0;
    let characters = 0;
    let failed = '';

    for (const char of getLibraryCharacters()) {
        const mine = (char.images || []).filter(p => p.startsWith(from) && !held.has(p));
        if (mine.length === 0) continue;

        const folder = claimFolder(char);
        if (!folder) continue;

        let any = false;
        try {
            for (const oldPath of mine) {
                if (await moveOne(char, oldPath, folder)) { moved++; any = true; }
            }
        } catch (err) {
            failed = `${char.name}: ${err?.message ?? err}`;
            debugLog('Stopped moving pictures into folders', err);
        }

        if (any) { characters++; saveSettings(); }
        // Stop the whole pass, so a server that has started refusing is not hammered
        // nineteen more times. The next load resumes from where this one stopped.
        if (failed) return { moved, characters, failed };
    }

    /* Only once everything got through. Set on a partial pass, the pictures left behind
       would never be looked at again. */
    settings.imagesFoldered = true;
    saveSettings();
    return { moved, characters, failed };
}
