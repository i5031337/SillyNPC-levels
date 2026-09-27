import { Popup } from '../../../../../../popup.js';
import { isChatCharacter } from '../../characters/character-repository.js';
import {
    createCharacter,
    deleteCharacter,
    reorderCharacters,
    moveCharacterToCategory,
    getAllCategories,
    deleteCategory,
    renameCategory,
    moveCategory,
    getChatCast,
    setChatCast,
    isCharacterInChat,
    addCharacterToChat,
    instantiateWorldCharacter,
} from '../../characters/characters.js';
import { triggerReprocess } from '../../chat/chat.js';
import { hasOpenChat } from '../../tracker/status-logic.js';
import { buildBulkCheckbox } from '../shared/ui-bulk-select.js';
import { makeActivatable } from '../../core/utils.js';

import { manageState } from './ui-manage-state.js';

export function buildCategoryHeading(cat, refreshGrid) {
    const heading = document.createElement('div');
    heading.className = 'sillynpc-category-heading';
    heading.draggable = true;
    heading.dataset.category = cat;

    heading.addEventListener('dragstart', (e) => {
        manageState.draggedCategory = cat;
        heading.classList.add('dragging');
        e.dataTransfer.setData('text/plain', cat);
        e.dataTransfer.effectAllowed = 'move';
        // SillyTavern's global handler reads a loose drag as a file upload.
        e.stopPropagation();
    });
    heading.addEventListener('dragend', (e) => {
        heading.classList.remove('dragging');
        manageState.draggedCategory = null;
        // Both states: a drag that ends outside any heading leaves whichever one it last
        // hovered still lit, and the two are different classes.
        manageState.manageRoot.querySelectorAll('.drag-over, .drag-over-category')
            .forEach(el => el.classList.remove('drag-over', 'drag-over-category'));
        e.stopPropagation();
    });

    heading.addEventListener('dragover', (e) => {
        const takesIt = manageState.draggedCharId || (manageState.draggedCategory && manageState.draggedCategory !== cat);
        if (!takesIt) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        heading.classList.add(manageState.draggedCategory ? 'drag-over-category' : 'drag-over');
    });
    heading.addEventListener('dragleave', () => {
        heading.classList.remove('drag-over', 'drag-over-category');
    });
    heading.addEventListener('drop', (e) => {
        const card = manageState.draggedCharId;
        const category = manageState.draggedCategory;
        if (!card && !category) return;
        e.preventDefault();
        e.stopPropagation();
        heading.classList.remove('drag-over', 'drag-over-category');
        // A card lands in this category; a heading takes this one's place in the order.
        if (card) moveCharacterToCategory(card, cat);
        else if (category !== cat) moveCategory(category, cat);
        refreshGrid();
    });

    const label = document.createElement('span');
    label.className = 'sillynpc-category-label';
    label.textContent = cat;

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'sillynpc-category-rename';
    renameBtn.title = `Rename category "${cat}"`;
    renameBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    renameBtn.addEventListener('click', async () => {
        const typed = (await Popup.show.input(`Rename "${cat}"`, 'New name:', cat))?.trim();
        if (!typed || typed === cat) return;

        // Merging is not undone by renaming back, so it is asked about rather than done
        // quietly because two names happened to collide.
        if (getAllCategories().includes(typed)) {
            const merge = await Popup.show.confirm(`Merge into "${typed}"?`,
                `"${typed}" already exists. Everyone in "${cat}" will join it, and the two `
                + 'cannot be separated again by renaming.');
            if (!merge) return;
        }

        renameCategory(cat, typed);
        refreshGrid();
        // A renamed category can change who is in the open chat, and every card shows
        // whether they are.
        triggerReprocess();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'sillynpc-category-delete';
    deleteBtn.title = `Delete category "${cat}"`;
    deleteBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    deleteBtn.addEventListener('click', async () => {
        const confirmed = await Popup.show.confirm(`Delete category "${cat}"?`, 'Characters will be moved to uncategorized.');
        if (!confirmed) return;
        deleteCategory(cat);
        refreshGrid();
        triggerReprocess();
    });

    heading.append(label, renameBtn, deleteBtn);
    return heading;
}

export function buildCard(char, { refreshGrid, openEditor }) {
    const card = document.createElement('div');
    card.className = 'sillynpc-card';
    card.dataset.id = char.id;

    // Shown but dimmed rather than hidden: a character you cannot see is one you cannot
    // let back in, and "where did everyone go" is the wrong thing to learn from a filter.
    const inChat = !hasOpenChat() || isCharacterInChat(char);
    if (!inChat) card.classList.add('sillynpc-card-out-of-chat');
    card.title = (char.name || '(unnamed)')
        + (inChat ? '' : ' — not in this chat');
    // Was role + tabindex and no key handler: it took focus, announced itself as a
    // button and did nothing when pressed. This adds the half that was missing.
    makeActivatable(card, { label: card.title });
    card.setAttribute('draggable', 'true');

    if (char.imageUrl) {
        const img = document.createElement('img');
        img.className = 'sillynpc-card-img';
        img.src = char.imageUrl;
        img.setAttribute('draggable', 'false');
        img.onerror = () => img.remove();
        card.appendChild(img);
    } else {
        const fallback = document.createElement('div');
        fallback.className = 'sillynpc-card-fallback';
        fallback.textContent = (char.name || '?').slice(0, 2).toUpperCase();
        card.appendChild(fallback);
    }
    
    if (char.color) {
        const stripe = document.createElement('div');
        stripe.className = 'sillynpc-card-color-stripe';
        stripe.style.backgroundColor = char.color;
        card.appendChild(stripe);
    }

    const label = document.createElement('div');
    label.className = 'sillynpc-card-label';
    label.textContent = char.name || '(unnamed)';
    card.appendChild(label);

    if (hasOpenChat() && !isChatCharacter(char.id) && char.name) {
        const bring = document.createElement('button');
        bring.type = 'button';
        bring.className = 'menu_button';
        bring.textContent = 'Use in this chat';
        bring.title = 'Create an independent chat NPC from this reusable character.';
        bring.addEventListener('click', e => {
            e.stopPropagation();
            const instance = instantiateWorldCharacter(char.id);
            if (instance) {
                refreshGrid();
                openEditor(instance.id);
                triggerReprocess();
            }
        });
        card.appendChild(bring);
    }

    // While selecting, the card carries a checkbox instead of its own trash: two ways to
    // delete on one card, asking different questions, is how a tick becomes a deletion.
    if (manageState.gridBulk?.isActive()) {
        card.appendChild(buildBulkCheckbox(manageState.gridBulk, char.id));
    } else {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'sillynpc-card-delete';
        deleteBtn.title = 'Delete character';
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (await Popup.show.confirm(`Delete "${char.name || 'this character'}"?`)) {
                deleteCharacter(char.id);
                refreshGrid();
            }
        });
        card.appendChild(deleteBtn);
    }

    // Only worth offering once a chat is actually being scoped; on an unscoped chat
    // everybody is already in and the control would mean nothing.
    if (hasOpenChat() && getChatCast().categories !== null) {
        const scopeBtn = document.createElement('button');
        scopeBtn.type = 'button';
        scopeBtn.className = 'sillynpc-card-scope';
        scopeBtn.title = inChat ? 'Keep out of this chat' : 'Let into this chat';
        scopeBtn.innerHTML = inChat
            ? '<i class="fa-solid fa-eye"></i>'
            : '<i class="fa-solid fa-eye-slash"></i>';
        scopeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cast = getChatCast();
            setChatCast({
                categories: cast.categories,
                include: inChat ? cast.include.filter(x => x !== char.id)
                                : [...cast.include, char.id],
                exclude: inChat ? [...cast.exclude, char.id]
                                : cast.exclude.filter(x => x !== char.id),
            });
            refreshGrid();
            triggerReprocess();
        });
        card.appendChild(scopeBtn);
    }

    card.addEventListener('click', () => {
        // While selecting, the whole card is the tick target. Opening the editor from a
        // click meant to choose a card is the opposite of what the mode is for.
        if (manageState.gridBulk?.isActive()) {
            manageState.gridBulk.toggle(char.id, !manageState.gridBulk.isSelected(char.id));
            refreshGrid();
            return;
        }
        openEditor(char.id);
    });
    
    // Drag & Drop
    card.addEventListener('dragstart', (e) => {
        manageState.draggedCharId = char.id;
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', char.id);
        e.dataTransfer.effectAllowed = 'move';
        // Stop propagation to prevent SillyTavern's global drag/drop from thinking this is a file upload
        e.stopPropagation();
    });
    card.addEventListener('dragend', (e) => {
        card.classList.remove('dragging');
        manageState.draggedCharId = null;
        manageState.manageRoot.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        e.stopPropagation();
    });
    card.addEventListener('dragover', (e) => {
        if (manageState.draggedCharId && manageState.draggedCharId !== char.id) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            card.classList.add('drag-over');
        }
    });
    card.addEventListener('dragleave', (e) => {
        card.classList.remove('drag-over');
        e.stopPropagation();
    });
    card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        card.classList.remove('drag-over');
        if (manageState.draggedCharId && manageState.draggedCharId !== char.id) {
            reorderCharacters(manageState.draggedCharId, char.id);
            refreshGrid();
        }
    });

    return card;
}

export function buildAddCard(openEditor) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'sillynpc-card sillynpc-card-add';
    card.title = 'Add character';
    card.innerHTML = '<i class="fa-solid fa-plus"></i>';
    card.addEventListener('click', () => {
        const char = createCharacter();
        // Made while a chat is open, so they belong to it - the same as a card made from a
        // message. Without this, somebody created for the scene you are in is invisible in
        // it the moment that chat is limited to categories.
        addCharacterToChat(char.id);
        openEditor(char.id);
    });
    return card;
}

/* ─── Editor View ────────────────────────────────────────────────────────── */

/**
 * Which face of a character is showing: what is known, or the form that changes it.
 *
 * Reset to 'profile' every time a character is opened, so arriving somewhere always means
 * arriving at the readable page. Changing it does not persist: coming back to somebody
 * later is arriving again.
 *
 * @type {'profile'|'edit'|'pictures'}
 */
