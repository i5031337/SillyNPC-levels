import { LOG_PREFIX } from '../../core/constants.js';
import { escapeHtml } from '../../core/utils.js';
import { openLightbox } from '../characters/ui-portrait.js';
import {
    taggedFields,
    getImageTag,
    setImageTag,
    tagsFromFilename,
    valuesByField,
} from '../../characters/image-tags.js';
import { folderFor, refreshCharacterImages } from '../../characters/character-images.js';
import { buildChoiceSelect } from '../shared/ui-shared.js';

export function renderPictureTagsSection(char, container, refreshEditor) {
    if (!container) return;
    container.replaceChildren();

    /* Nothing has asked for tags, so there is nothing here to configure and no heading
       either. This is the whole of "the control appears only when something wants it". */
    const fields = taggedFields();
    if (fields.length === 0) return;

    /* Its own header rather than the borrowed .sillynpc-aliases-header. That class has no
       rule anywhere, so its label and its note run together on one line - which passes
       unnoticed as a small section heading inside a column and does not as the title of a
       page. Not fixing it for the other sections here: they have looked that way for
       months and changing five headings is not this change. */
    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'Picture Tags';
    container.append(title);

    const note = document.createElement('small');
    note.className = 'notes sillynpc-tag-note';
    note.textContent = "Which of this character's pictures stands for which value. "
        + 'A picture means everything it is tagged with at once, so one tagged Wounded and '
        + 'Rain is only drawn when both hold - and beats a plain Wounded when they do. '
        + 'Pictures sharing a tag take turns as the story runs.';
    container.append(note);

    /* --- where to put the files ---
     *
     * The point of the folder is that a generator can write straight into it and a name
     * can say what a picture is for, and neither is discoverable from a grid of
     * thumbnails. So the path is on the page, next to the pictures it explains. */
    const where = document.createElement('small');
    where.className = 'notes sillynpc-tag-note';
    const folder = folderFor(char);
    where.innerHTML = `Drop pictures into <code>user/images/${escapeHtml(folder)}/</code> `
        + 'and press Refresh. A file named for a value is tagged with it automatically - '
        + '<code>wounded.png</code>, <code>wounded-2.png</code> for a second of them, '
        + '<code>wounded.rain.png</code> for one meaning both.';
    container.append(where);

    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'menu_button sillynpc-tag-refresh';
    refresh.innerHTML = '<i class="fa-solid fa-rotate"></i> Refresh from folder';
    refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        try {
            await refreshCharacterImages(char);
            refreshEditor();
        } catch (err) {
            console.error(LOG_PREFIX, 'Could not re-read the picture folder', err);
            refresh.disabled = false;
        }
    });
    container.append(refresh);

    /* Said, rather than shown as a blank space. Something has asked for tags, so the
       heading is there and its absence would read as a bug - "this character has one
       picture" is an answer, and it names what to do about it. */
    const gallery = Array.isArray(char.images) ? char.images.filter(Boolean) : [];
    if (gallery.length === 0) {
        const empty = document.createElement('small');
        empty.className = 'notes';
        empty.textContent = 'No pictures in that folder yet. Generate one, or drop files '
            + 'in and press Refresh.';
        container.append(empty);
        return;
    }

    // Read once for the whole grid rather than per row per field.
    const allowed = valuesByField();

    const grid = document.createElement('div');
    grid.className = 'sillynpc-tag-grid';

    gallery.forEach((path, index) => {
        const row = document.createElement('div');
        row.className = 'sillynpc-tag-row';

        const thumb = document.createElement('img');
        thumb.className = 'sillynpc-tag-thumb';
        thumb.src = path;
        thumb.alt = `Picture ${index + 1}`;
        // The grid is thumbnails; this is the only way to see which picture a row is.
        thumb.title = 'Click to view full size';
        thumb.addEventListener('click', () => openLightbox(path));
        /* The one in use, marked. Gallery order decides between two pictures carrying the
           same tag, and the reader has no other way to see what that order is. */
        if (path === char.imageUrl) thumb.classList.add('in-use');
        row.append(thumb);

        const selects = document.createElement('div');
        selects.className = 'sillynpc-tag-fields';

        for (const field of fields) {
            const values = allowed[field] ?? [];
            const cell = document.createElement('label');
            cell.className = 'sillynpc-tag-field';

            const name = document.createElement('small');
            name.textContent = field;
            cell.append(name);

            /* A field whose values are not enumerated has nothing to offer. It should
               never reach here - the picker on the other side only lists fields with an
               Allowed values list - so this says why rather than drawing an empty box. */
            if (values.length === 0) {
                const none = document.createElement('small');
                none.className = 'notes';
                none.textContent = 'no allowed values set';
                cell.append(none);
                selects.append(cell);
                continue;
            }

            /* --- what the filename already said, shown rather than assumed ---
             *
             * Forty files named for their values need no clicking at all, and a grid of
             * forty empty dropdowns beside them would say the opposite. So a value the
             * filename supplies appears in the box, marked as coming from the name, and
             * choosing something is how you override it. Clearing the box goes back to
             * the filename rather than to nothing, which is why the blank option says so.
             */
            const explicit = getImageTag(char, path, field);
            const derived = tagsFromFilename(path, allowed)[field] ?? '';

            const select = buildChoiceSelect(values, explicit);
            if (!explicit && derived) {
                // Not selected: the name is already the answer and picking it again would
                // write a tag that says nothing new and would outlive a rename.
                const blank = select.querySelector('option[value=""]');
                if (blank) blank.textContent = `${derived} (from the file name)`;
                select.classList.add('is-derived');
            }
            select.addEventListener('change', () => {
                setImageTag(char, path, field, select.value);
                renderPictureTagsSection(char, container, refreshEditor);
            });
            cell.append(select);
            selects.append(cell);
        }

        /* The file this card is. Without it there is no way to tell which file on disk to
           rename - and renaming is the whole of tagging here - short of opening each
           picture and guessing. Decoded, because the path is a URL and a name with a space
           or an accent would otherwise read as "Varga%20Elza". */
        const fileName = document.createElement('div');
        fileName.className = 'sillynpc-tag-filename';
        let shown = path.split('/').pop() || path;
        try { shown = decodeURIComponent(shown); } catch { /* keep it as written */ }
        fileName.textContent = shown;
        fileName.title = shown;
        selects.append(fileName);

        row.append(selects);
        grid.append(row);
    });

    container.append(grid);
}
