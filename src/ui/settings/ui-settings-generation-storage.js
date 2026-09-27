import { getSettings, saveSettings } from '../../core/settings.js';
import { resolveImageFolder, describeSaveDestination } from '../../core/utils.js';
import { scanFolderForCharacterImages, findOrphanedImages, deleteImageFiles } from '../../api/api.js';
import { Popup } from '../../../../../../popup.js';
import { listUserImageFolders, pickImageFolder } from './ui-settings-generation-helpers.js';

export function renderImageStorageSettings(view) {
        view.append(buildImageFolderSetting(), buildImageScanSetting(), buildImageCleanupSetting());
}

function buildImageFolderSetting() {
    const pathWrap = document.createElement('div');
    pathWrap.className = 'sillynpc-setting';

    const pathRow = document.createElement('label');
    pathRow.className = 'sillynpc-setting-row';
    pathRow.style.fontWeight = 'bold';
    pathRow.textContent = 'Folder Name';

    const fieldWrap = document.createElement('div');
    fieldWrap.className = 'sillynpc-path-field';

    // Shows where the file really lands. The field is not a path and never was: the upload
    // route sanitises ch_name to a single segment server-side, so "images/sillynpc" arrives
    // as "sillynpc". Saying so beats letting the user infer a nesting that does not happen.
    const resolved = document.createElement('small');
    resolved.className = 'notes';
    resolved.style.cssText = 'display:block; margin-top:4px;';
    const showResolved = () => {
        resolved.textContent = describeSaveDestination(getSettings().imageSaveRoute);
    };

    const pathInput = document.createElement('input');
    pathInput.type = 'text';
    pathInput.className = 'text_pole';
    pathInput.id = 'sillynpc-save-path';
    pathInput.value = getSettings().imageSaveRoute;
    pathInput.addEventListener('input', () => {
        getSettings().imageSaveRoute = pathInput.value;
        showResolved();
        saveSettings();
    });
    // On blur rather than on input: cleaning mid-keystroke would eat the separator as it
    // is typed, so the field could never hold one long enough to explain itself. The line
    // above does the explaining while typing; this settles it once the user has finished.
    pathInput.addEventListener('change', () => {
        const folder = resolveImageFolder(pathInput.value);
        if (pathInput.value === folder) return;
        pathInput.value = folder;
        getSettings().imageSaveRoute = folder;
        showResolved();
        saveSettings();
    });

    const browsePathBtn = document.createElement('button');
    browsePathBtn.type = 'button';
    browsePathBtn.className = 'menu_button browse-path-btn';
    browsePathBtn.title = 'Browse folders';
    browsePathBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i>';
    browsePathBtn.addEventListener('click', async () => {
        // The old handler was a text prompt wearing a folder icon - it asked for the same
        // string the field already held and could not tell you what existed. The server
        // lists the real directories, so offer those.
        const folders = await listUserImageFolders();
        const chosen = await pickImageFolder(folders, getSettings().imageSaveRoute);
        if (!chosen) return;
        // A name picked from the list is already one segment; one typed into the popup is
        // not, and arrives by the same door.
        const folder = resolveImageFolder(chosen);
        getSettings().imageSaveRoute = folder;
        pathInput.value = folder;
        showResolved();
        saveSettings();
    });

    fieldWrap.append(pathInput, browsePathBtn);

    const notes = document.createElement('small');
    notes.className = 'notes';
    notes.textContent = 'One folder name under user/images/, not a path - portraits are '
        + 'written there rather than stored inline in your settings file.';

    showResolved();
    pathWrap.append(pathRow, fieldWrap, resolved, notes);
    return pathWrap;
}

function buildImageScanSetting() {
    // Portraits were written here long before the extension kept a list of them, so a
    // character can have several pictures in the folder and know about one.
    const scanWrap = document.createElement('div');
    scanWrap.className = 'sillynpc-setting';

    const scanBtn = document.createElement('button');
    scanBtn.type = 'button';
    scanBtn.className = 'menu_button';
    scanBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Find existing images';
    scanBtn.addEventListener('click', async () => {
        scanBtn.disabled = true;
        try {
            const { scanned, added, characters } = await scanFolderForCharacterImages();
            if (!added) {
                toastr.info(`Looked at ${scanned} file${scanned === 1 ? '' : 's'}; nothing new to add.`, 'SillyNPC');
            } else {
                toastr.success(
                    `Added ${added} image${added === 1 ? '' : 's'} to ${characters} character${characters === 1 ? '' : 's'}.`,
                    'SillyNPC',
                );
            }
        } catch (err) {
            toastr.error(err.message, 'SillyNPC');
        } finally {
            scanBtn.disabled = false;
        }
    });

    const scanNote = document.createElement('small');
    scanNote.className = 'notes';
    scanNote.style.cssText = 'display:block; margin-top:4px;';
    scanNote.textContent = 'Matches files in the folder above to characters by the name they '
        + "were saved under, and adds anything missing to that character's image list. "
        + "Only finds images SillyNPC generated: pictures made through SillyTavern's own "
        + 'gallery are named after the character card, so there is nothing in the filename '
        + 'to match them by.';

    scanWrap.append(scanBtn, scanNote);
    return scanWrap;
}

function buildImageCleanupSetting() {
    /* The other direction: files nothing points at any more.
     *
     * Deleting a character has never deleted its pictures, and deliberately still does not -
     * deleteFile is opt-in throughout so that the destructive reading is never the one that
     * happens by omission. The cost is that they accumulate, and there was no way to see how
     * many or get rid of them. This shows the count and the size first and deletes only on a
     * confirm that names both. */
    const tidyWrap = document.createElement('div');
    tidyWrap.className = 'sillynpc-setting';

    const tidyBtn = document.createElement('button');
    tidyBtn.type = 'button';
    tidyBtn.className = 'menu_button';
    tidyBtn.innerHTML = '<i class="fa-solid fa-broom"></i> Remove unused portraits';
    tidyBtn.addEventListener('click', async () => {
        tidyBtn.disabled = true;
        try {
            const { files, scanned, folder } = await findOrphanedImages();
            if (!files.length) {
                toastr.info(
                    `Looked at ${scanned} file${scanned === 1 ? '' : 's'}; every one is still in use.`,
                    'SillyNPC');
                return;
            }

            // Named, so the confirm is about particular pictures rather than a number.
            const sample = files.slice(0, 5).map(p => p.split('/').pop()).join('\n');
            const more = files.length > 5 ? `\n...and ${files.length - 5} more` : '';
            const ok = await Popup.show.confirm(
                'Remove unused portraits',
                `${files.length} of ${scanned} file${scanned === 1 ? '' : 's'} in `
                + `user/images/${folder} are not used by any character in any chat, persona or fallback `
                + `portrait:\n\n${sample}${more}\n\nDelete them? This cannot be undone.`);
            if (!ok) return;

            const { deleted, failed } = await deleteImageFiles(files);
            if (failed) {
                toastr.warning(`Deleted ${deleted}; ${failed} could not be removed.`, 'SillyNPC');
            } else {
                toastr.success(`Deleted ${deleted} unused portrait${deleted === 1 ? '' : 's'}.`, 'SillyNPC');
            }
        } catch (err) {
            toastr.error(err.message, 'SillyNPC');
        } finally {
            tidyBtn.disabled = false;
        }
    });

    const tidyNote = document.createElement('small');
    tidyNote.className = 'notes';
    tidyNote.style.cssText = 'display:block; margin-top:4px;';
    tidyNote.textContent = 'Finds pictures in the folder above that no character, persona or '
        + 'fallback portrait points at - usually left behind by characters you have since '
        + 'deleted. Shows you what it found before removing anything. A picture still used '
        + 'by anybody, including you, is never touched.';

    tidyWrap.append(tidyBtn, tidyNote);
    return tidyWrap;
}
