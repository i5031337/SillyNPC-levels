import { eventSource } from '../../../../../../events.js';
import { loadStateFromMetadata, registerActiveCharacter } from '../status-logic.js';
import { LOG_PREFIX } from '../../core/constants.js';
import { makeActivatable } from '../../core/utils.js';
import { getActiveCharacters } from '../../characters/characters.js';

/**
 * Where a menu opened from a button goes, in the window's coordinates.
 *
 * Below the button when there is room, above it when there is not, and never past either
 * side. It always went below, a hundred pixels to the left, relative to the page - which
 * put it off the bottom of the screen for a tracker box drawn at the foot of the window, as
 * the visual novel stage draws it, so Add character appeared to do nothing.
 *
 * @param {{ top: number, bottom: number, left: number }} rect The button.
 * @param {{ width: number, height: number }} size The menu.
 * @param {{ width: number, height: number }} view The window.
 * @returns {{ top: number, left: number }}
 */
export function placeMenu(rect, size, view, gap = 5) {
    const below = rect.bottom + gap;
    const top = below + size.height <= view.height
        ? below
        : Math.max(gap, rect.top - gap - size.height);
    const left = Math.min(Math.max(gap, rect.left - 100), Math.max(gap, view.width - size.width - gap));
    return { top, left };
}

/**
 * Tells everything that shows the scene - the HUD, the chat's tracker boxes, the visual novel
 * stage's box - that somebody joined or left it. Adding and removing saved the state and
 * redrew only the one box that was clicked, so the others kept the old cast until something
 * else happened to redraw them.
 */
export function announceSceneChange() {
    try {
        eventSource.emit('sillynpc-status-updated', loadStateFromMetadata());
    } catch (err) {
        console.error(LOG_PREFIX, 'could not announce the scene change', err);
    }
}

export function showAddCharacterDropdown(btn, mesEl, onRedraw = null, redrawMessage = null) {
    if (!btn) return;
    const existing = document.querySelector('.sillynpc-add-char-dropdown');
    if (existing) {
        existing.remove();
        return;
    }

    const state = loadStateFromMetadata();
    const activeNames = new Set(state.characters.map(c => c.name.toLowerCase()));
    const allChars = getActiveCharacters();
    const available = allChars.filter(c => !activeNames.has(c.name.toLowerCase()));

    if (available.length === 0) return;

    const dropdown = document.createElement('div');
    dropdown.className = 'sillynpc-add-char-dropdown list-group';
    dropdown.style.cssText = 'position: fixed; background: var(--sillynpc-bg-primary); border: 1px solid var(--sillynpc-border); border-radius: 5px; padding: 5px; z-index: 1000; max-height: 200px; overflow-y: auto; box-shadow: 0 4px 6px rgba(0,0,0,0.3); font-size: var(--sillynpc-text-base); min-width: 150px;';

    available.forEach(char => {
        const item = document.createElement('div');
        item.className = 'list-group-item';
        item.style.cssText = 'cursor: pointer; padding: 5px 10px; border-bottom: 1px solid var(--sillynpc-border);';
        item.textContent = char.name;
        makeActivatable(item, { label: `Add ${char.name} to the scene` });
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            if (registerActiveCharacter(char.name)) {
                if (mesEl) redrawMessage?.(mesEl);
                onRedraw?.();
                announceSceneChange();
            }
            dropdown.remove();
        });
        dropdown.appendChild(item);
    });

    const closeDropdown = (e) => {
        if (!dropdown.contains(e.target) && e.target !== btn) {
            dropdown.remove();
            document.removeEventListener('click', closeDropdown);
        }
    };
    setTimeout(() => document.addEventListener('click', closeDropdown), 0);

    // Placed once it is in the page and has a size to place.
    dropdown.style.visibility = 'hidden';
    document.body.appendChild(dropdown);
    const rect = btn.getBoundingClientRect();
    const { top, left } = placeMenu(rect,
        { width: dropdown.offsetWidth, height: dropdown.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight });
    dropdown.style.top = `${top}px`;
    dropdown.style.left = `${left}px`;
    dropdown.style.visibility = '';
}
