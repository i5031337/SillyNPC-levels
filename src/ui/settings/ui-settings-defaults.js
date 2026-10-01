import { clearRuns } from '../../characters/default-portraits.js';
import { triggerReprocess } from '../../chat/chat.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { pickAndProcessImages } from '../../core/utils.js';
import { buildSettingNumber } from '../shared/ui-shared.js';
import { Popup } from '../../../../../../popup.js';
import { LOG_PREFIX } from '../../core/constants.js';
import { persistGeneratedImage } from '../../api/api.js';

export function renderDefaultView(view, rerender) {
    if (!view) return;

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'Faces For Strangers';
    view.appendChild(title);

    const help = document.createElement('p');
    help.className = 'notes sillynpc-pool-note';
    help.textContent = 'Anybody who speaks without a card of their own wears one of these, '
        + 'and so does a character whose card has no portrait yet. Add as many as you like: '
        + 'with only one, every stranger in the story is the same face.';
    view.appendChild(help);

    const sticky = document.createElement('p');
    sticky.className = 'notes sillynpc-pool-note';
    sticky.textContent = 'A face is drawn once and kept, not picked again on every redraw. '
        + 'A stranger holds theirs while they keep appearing and draws a new one if they '
        + 'turn up again much later - the guard you talk to for three messages is one '
        + 'guard, and the guard two hundred messages later is somebody else. A character '
        + 'with a card keeps theirs for good, until you give them a portrait.';
    view.appendChild(sticky);

    const pool = Array.isArray(getSettings().defaultImages) ? getSettings().defaultImages : [];

    const grid = document.createElement('div');
    grid.className = 'sillynpc-pool-grid';

    if (pool.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'notes sillynpc-pool-empty';
        empty.textContent = 'No faces yet. Until there is at least one, a speaker with no '
            + 'card gets the plain silhouette.';
        grid.appendChild(empty);
    }

    pool.forEach((entry, index) => {
        const cell = document.createElement('div');
        cell.className = 'sillynpc-pool-cell';

        const frame = document.createElement('div');
        frame.className = 'sillynpc-pool-frame';
        const img = document.createElement('img');
        img.src = entry.src;
        img.alt = '';
        frame.appendChild(img);
        cell.appendChild(frame);

        // Free text rather than a fixed vocabulary: what a world is full of is the world's
        // business. A stranger's kind is chosen from these by the tracker's reader; a card
        // still matches them against its name and category.
        const tags = document.createElement('input');
        tags.type = 'text';
        tags.className = 'text_pole sillynpc-pool-tags';
        tags.placeholder = 'monster, civilian';
        tags.title = 'Kinds of people this face is for. When a speaker with no card appears, the '
            + 'tracker picks their kind from all the tags here, and they wear a face tagged with '
            + 'it - or an untagged one if none fits. A face tagged for one kind is never given '
            + 'to another.';
        tags.value = (entry.tags || []).join(', ');
        tags.addEventListener('change', () => {
            entry.tags = tags.value.split(',').map(t => t.trim()).filter(Boolean);
            saveSettings();
        });
        cell.appendChild(tags);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'menu_button sillynpc-pool-remove';
        remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        remove.title = 'Take this face out of the pool.';
        remove.addEventListener('click', () => {
            getSettings().defaultImages.splice(index, 1);
            saveSettings();
            // Anybody already wearing it is given another the next time they are drawn;
            // faceForCard checks that the face it remembers is still in the pool.
            rerender?.();
        });
        cell.appendChild(remove);

        grid.appendChild(cell);
    });

    view.appendChild(grid);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'menu_button';
    addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> <span>Add faces</span>';
    addBtn.title = 'Choose one or several pictures at once.';
    addBtn.addEventListener('click', async () => {
        // Full size, because these are written to disk like any other portrait rather than
        // stored inline - the small cap only ever cost quality.
        const picked = await pickAndProcessImages({ fullSize: true });
        if (!picked.length) return;

        addBtn.disabled = true;
        try {
            const settings = getSettings();
            if (!Array.isArray(settings.defaultImages)) settings.defaultImages = [];
            for (const dataUri of picked) {
                const stored = await persistGeneratedImage(dataUri, 'default');
                settings.defaultImages.push({ src: stored, tags: [] });
            }
            saveSettings();
            toastr.success(`Added ${picked.length} face${picked.length === 1 ? '' : 's'}.`, 'SillyNPC');
        } catch (err) {
            console.error(LOG_PREFIX, 'Could not add fallback portraits', err);
            toastr.error(String(err.message || err), 'SillyNPC');
        } finally {
            addBtn.disabled = false;
            rerender?.();
        }
    });
    view.appendChild(addBtn);

    // Only worth asking once there is more than one face to swap between.
    if (pool.length > 1) {
        view.appendChild(buildSettingNumber({
            key: 'defaultPortraitRunGap',
            label: 'A Stranger Is Somebody New After',
            suffix: 'messages away',
            help: 'How long a stranger can be absent before the next sighting draws a new '
                + 'face. Lower means a busier world of one-off faces; higher means the same '
                + 'stranger is remembered across a longer stretch of story.',
        }));

        const forget = document.createElement('button');
        forget.type = 'button';
        forget.className = 'menu_button';
        forget.innerHTML = '<i class="fa-solid fa-arrow-rotate-left"></i> <span>Redraw every face in this chat</span>';
        forget.title = 'Forgets which face this chat gave to whom, so everybody draws again.';
        forget.addEventListener('click', async () => {
            const ok = await Popup.show.confirm('Redraw every face',
                'Everybody without a card of their own draws a new face. Nothing else changes.');
            if (!ok) return;
            clearRuns();
            triggerReprocess();
            rerender?.();
        });
        view.appendChild(forget);
    }
}
