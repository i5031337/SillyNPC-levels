import { POPUP_TYPE, Popup } from '../../../../../../popup.js';
import { LOG_PREFIX, NPC_LORE_FIELDS } from '../../core/constants.js';
import { getLibraryCharacters } from '../../characters/character-repository.js';
import {
    deleteCharacter,
    findCharacter,
    moveCharacterToCategory,
    getAllCategories,
    createCategory,
    getChatCast,
    setChatCast,
    UNCATEGORISED,
} from '../../characters/characters.js';
import { triggerReprocess } from '../../chat/chat.js';
import { syncAllLorebooks } from '../../lore/lorebook.js';
import { fillProfile } from '../../characters/character-fill.js';
import { hasOpenChat } from '../../tracker/status-logic.js';
import { buildBulkBar } from '../shared/ui-bulk-select.js';
import { exportCharacterFile, importCharacterFile } from '../shared/ui-transfer.js';
import { buildGridFilterRow } from '../characters/ui-grid-filter.js';

import { manageState } from './ui-manage-state.js';
import { buildCategoryHeading, buildCard, buildAddCard } from './ui-manage-cards.js';

function buildSyncAllRow(characters, refreshGrid) {
    const row = document.createElement('div');
    row.className = 'sillynpc-sync-all-row';

    const unlinked = (characters || []).filter(c => c.name && !c.lorebook).length;

    const note = document.createElement('small');
    note.className = 'notes';
    note.textContent = unlinked
        ? `${unlinked} character${unlinked === 1 ? '' : 's'} with no lorebook entry.`
        : 'Every character with a name is linked to a lorebook entry.';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu_button';
    btn.disabled = unlinked === 0;
    btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sync All';
    btn.title = 'Look through your lorebooks for an entry matching each unlinked '
        + 'character, by name, alias or keyword.';
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            const { linked, checked } = await syncAllLorebooks();
            if (linked) toastr.success(`Linked ${linked} of ${checked}.`, 'SillyNPC');
            else toastr.info(`No matching entries found for ${checked}.`, 'SillyNPC');
        } catch (err) {
            console.error(LOG_PREFIX, 'Sync all failed', err);
            toastr.error(String(err.message || err), 'SillyNPC');
        }
        refreshGrid();
    });

    // A category used to exist only while somebody was in it, so there was no way to set
    // one up before deciding who goes in it. It is an empty heading until a card is
    // dropped on it.
    const newCategoryBtn = document.createElement('button');
    newCategoryBtn.type = 'button';
    newCategoryBtn.className = 'menu_button';
    newCategoryBtn.innerHTML = '<i class="fa-solid fa-folder-plus"></i> <span>New Category</span>';
    newCategoryBtn.title = 'Add an empty category. Drag characters onto its heading to fill it.';
    newCategoryBtn.addEventListener('click', async () => {
        const name = (await Popup.show.input('New category', 'Enter a name:'))?.trim();
        if (!name) return;
        if (!createCategory(name)) {
            toastr.info(`"${name}" already exists.`, 'SillyNPC');
            return;
        }
        refreshGrid();
    });

    // Bringing a character in from a file. Distinct from the Import in the header above,
    // which reads a whole-settings backup and replaces everything - this one adds to what
    // is here, which is why it sits with the grid rather than beside its opposite.
    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.className = 'menu_button';
    importBtn.innerHTML = '<i class="fa-solid fa-file-import"></i> <span>Import Character</span>';
    importBtn.title = 'Read a character file somebody sent you, and add them to this list.';
    importBtn.addEventListener('click', () => importCharacterFile(refreshGrid));

    row.append(note, ensureGridBulk(refreshGrid).bar, importBtn, newCategoryBtn, btn);
    return row;
}

/**
 * Which of this system's characters the open chat is for.
 *
 * Edited here rather than on the category, because the record lives on the chat: a
 * category holding a list of chat filenames goes stale the moment a chat is renamed, and
 * leaves dead entries behind when one is deleted.
 */
function buildChatScopeRow(refreshGrid) {
    const row = document.createElement('div');
    row.className = 'sillynpc-chat-scope';

    if (!hasOpenChat()) {
        const note = document.createElement('small');
        note.className = 'notes';
        note.textContent = 'Open a chat to choose which characters appear in it.';
        row.append(note);
        return row;
    }

    const cast = getChatCast();
    const scoped = cast.categories !== null;

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'sillynpc-chat-scope-toggle';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = scoped;
    toggle.addEventListener('change', () => {
        // Turning it off restores "everybody", which is what an unscoped chat means and
        // what every chat written before this reads as.
        setChatCast(toggle.checked
            ? { categories: getAllCategories(), include: cast.include, exclude: cast.exclude }
            : { categories: null, include: cast.include, exclude: cast.exclude });
        refreshGrid();
        triggerReprocess();
    });
    toggleLabel.append(toggle, document.createTextNode('Limit this chat to certain categories'));
    row.append(toggleLabel);

    if (!scoped) {
        const note = document.createElement('small');
        note.className = 'notes';
        note.textContent = 'Every character in this system appears in this chat.';
        row.append(note);
        return row;
    }

    const boxes = document.createElement('div');
    boxes.className = 'sillynpc-chat-scope-categories';
    // Uncategorised is offered like any other category rather than being a special case.
    for (const category of [UNCATEGORISED, ...getAllCategories()]) {
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = cast.categories.includes(category);
        box.addEventListener('change', () => {
            const next = new Set(getChatCast().categories || []);
            box.checked ? next.add(category) : next.delete(category);
            setChatCast({ categories: [...next], include: cast.include, exclude: cast.exclude });
            refreshGrid();
            triggerReprocess();
        });
        label.append(box, document.createTextNode(category || 'Uncategorised'));
        boxes.append(label);
    }
    row.append(boxes);

    const help = document.createElement('small');
    help.className = 'notes';
    help.textContent = 'Characters outside this chat are not decorated, not added to the '
        + 'scene cast, and their lore is not injected. Click a dimmed card to let one in '
        + 'anyway, or keep one out.';
    row.append(help);

    return row;
}

export function renderCardGrid(openEditor) {
    const refreshGrid = () => renderCardGrid(openEditor);
    const root = manageState.manageRoot.querySelector('#sillynpc-card-grid');
    if (!root) return;

    root.replaceChildren();

    // The full list on purpose: you have to be able to see somebody to put them back.
    const characters = getLibraryCharacters();
    root.appendChild(buildChatScopeRow(refreshGrid));
    root.appendChild(buildSyncAllRow(characters, refreshGrid));

    const filter = buildGridFilterRow(root);
    root.appendChild(filter.row);
    const groups = new Map();
    groups.set('', []);
    for (const char of characters) {
        const cat = char.category || '';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(char);
    }

    // The register's order, not the alphabet's, and every category in it - including one
    // nobody is in yet, which is the only way to file the first character into it.
    const categoryOrder = ['', ...getAllCategories()];

    for (const cat of categoryOrder) {
        const chars = groups.get(cat) || [];

        if (cat !== '') {
            root.appendChild(buildCategoryHeading(cat, refreshGrid));
        }

        const subgrid = document.createElement('div');
        subgrid.className = 'sillynpc-card-subgrid';
        subgrid.addEventListener('dragover', (e) => {
            if (manageState.draggedCharId) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
            }
        });
        subgrid.addEventListener('drop', (e) => {
            if (manageState.draggedCharId) {
                e.preventDefault();
                e.stopPropagation();
                moveCharacterToCategory(manageState.draggedCharId, cat);
                refreshGrid();
            }
        });

        for (const char of chars) {
            subgrid.appendChild(buildCard(char, { refreshGrid, openEditor }));
        }
        if (cat === '') {
            subgrid.appendChild(buildAddCard(openEditor));
        }
        root.appendChild(subgrid);
    }

    // Last, because there is nothing to filter until the cards are in.
    filter.apply();
}

/**
 * The card grid's bulk selection, kept across the redraws that ticking a card causes.
 *
 * Built lazily rather than at module load: it calls renderCardGrid, which is not defined
 * until this module has finished evaluating.
 */

/**
 * Writes one profile field again on every chosen character.
 *
 * The field is asked for after the count is confirmed, so the question is "which one" rather
 * than "are you sure" - the being-sure part has already happened.
 *
 * One at a time rather than in parallel: each is a request, and firing sixteen at a model
 * with a rate limit turns a slow job into a failed one. The toast reports what happened
 * rather than claiming success, because on a run this long some of them usually have nothing
 * to go on and it matters which.
 */
async function rewriteFieldOnMany(chars, refreshGrid) {
    if (!chars.length) return;

    const pick = document.createElement('select');
    pick.className = 'text_pole';
    for (const field of NPC_LORE_FIELDS) {
        const option = document.createElement('option');
        option.value = field.id;
        option.textContent = field.label;
        pick.append(option);
    }

    const wrap = document.createElement('div');
    const question = document.createElement('p');
    question.textContent = `Which field should be written again on these ${chars.length}?`;
    wrap.append(question, pick);

    if (!await new Popup(wrap, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Rewrite', cancelButton: 'Cancel',
    }).show()) return;

    const field = NPC_LORE_FIELDS.find(f => f.id === pick.value);
    if (!field) return;

    toastr.info(`Rewriting ${field.label} on ${chars.length}...`, 'SillyNPC');

    const done = [];
    const empty = [];
    const failed = [];
    for (const char of chars) {
        try {
            const result = await fillProfile(char, { fields: [field.id] });
            if (!result.ok) failed.push(char.name);
            else if (result.filled.length) done.push(char.name);
            else empty.push(char.name);
        } catch (err) {
            console.error(LOG_PREFIX, 'Rewriting a field failed for', char.name, err);
            failed.push(char.name);
        }
    }

    refreshGrid();

    const parts = [`${field.label}: rewrote ${done.length}`];
    if (empty.length) parts.push(`${empty.length} had nothing to go on`);
    if (failed.length) parts.push(`${failed.length} failed`);
    const report = parts.join(', ') + '.';
    if (failed.length) toastr.warning(report, 'SillyNPC');
    else toastr.success(report, 'SillyNPC');
}

export function ensureGridBulk(refreshGrid) {
    if (manageState.gridBulk) return manageState.gridBulk;
    manageState.gridBulk = buildBulkBar({
        noun: 'character',
        allIds: () => getLibraryCharacters().map(c => c.id),
        onDelete: (ids) => {
            for (const id of ids) deleteCharacter(id);
            toastr.success(`Deleted ${ids.length} character(s).`, 'SillyNPC');
        },
        onRefresh: refreshGrid,
        extra: [
            {
                label: 'Export selected',
                icon: 'fa-file-export',
                title: 'Write the chosen characters to one file you can send to somebody else.',
                onRun: (ids) => exportCharacterFile(
                    ids.map(id => findCharacter(id)).filter(Boolean)),
            },
            {
                label: 'Rewrite a field',
                icon: 'fa-rotate',
                title: 'Write one profile field again, from scratch, on every character '
                    + 'chosen. Replaces what is there.',
                // Asked before the field is even chosen, because the count is the part worth
                // seeing twice: rewriting one field by hand is a click, doing it to nine
                // characters is not something to discover afterwards.
                confirm: (ids) => `Write one profile field again on ${ids.length} `
                    + `character${ids.length === 1 ? '' : 's'}? Whatever those fields say now `
                    + 'is replaced, and only the last one can be put back.',
                onRun: (ids) => rewriteFieldOnMany(
                    ids.map(id => findCharacter(id)).filter(Boolean), refreshGrid),
            },
        ],
    });
    return manageState.gridBulk;
}

/**
 * The category heading being dragged, if one is.
 *
 * Separate from manageState.draggedCharId rather than one "what is being dragged": a heading is both
 * a drop target for a card and a draggable thing itself, and the two must not be mistaken
 * for each other - dropping a heading on a heading reorders, dropping a card on one files
 * the character.
 */

/**
 * One category's heading: its name, what can be done to it, and where cards land.
 *
 * @param {string} cat
 * @returns {HTMLElement}
 */
