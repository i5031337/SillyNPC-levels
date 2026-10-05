import { loadStateFromMetadata, applyUpdate, removeActiveCharacter } from '../status-logic.js';
import { announceSceneChange } from './status-ui-menu.js';

/**
 * @param {HTMLElement} container
 * @param {object} [drawn] What the box was drawn from.
 * @param {object} [drawn.state] The state it shows - which, under an older message, is that
 *   message's state, not the live one.
 */
export function attachInlineEditListeners(container, { state: drawnState = null, redrawMessage = null } = {}) {
    container.querySelectorAll('.sillynpc-status-editable').forEach(el => {
        el.addEventListener('blur', () => {
            const type = el.dataset.type;
            const key = el.dataset.key;
            const newValue = el.innerText.trim();

            /* Nothing typed, nothing written. This used to write on every blur, so merely
               clicking a value and clicking away ran a whole update: it aged every tombstone
               by one - and those expire after three, which is the guard that stops the model
               re-adding an item you just deleted by hand - and filed an undo entry labelled
               "AI update" for something the reader did. */
            if (newValue === String(el.dataset.initial ?? '')) return;
            el.dataset.initial = newValue;

            /* A character is found by name in the state this box shows. It used to be found
               by position in *today's* cast, so on an older message - or whenever the cast had
               been reordered since - the edit could land on somebody else entirely. */
            const shown = drawnState ?? loadStateFromMetadata();
            const charName = type === 'character'
                ? shown?.characters?.[parseInt(el.dataset.index)]?.name ?? ''
                : '';

            /* One branch per data-type buildStatusHtml emits. The player's was missing from
               the day player stats were first drawn in this box: the box rendered them
               contenteditable like everything else, this built an empty update, and
               applyUpdate({}) changed nothing - so the typed value simply came back on the
               next redraw with nothing to say it had been dropped. */
            const updateObj = {};
            if (type === 'global') {
                updateObj.global = { [key]: newValue };
            } else if (type === 'player') {
                // stats, rather than bare: applyUpdate reads `update.player.stats ||
                // update.player`, and the bare form would collide with `name`.
                updateObj.player = { stats: { [key]: newValue } };
            } else if (type === 'character' && charName) {
                updateObj.characters = [{ name: charName, stats: { [key]: newValue } }];
            }
            // Labelled, so the change history says who made it. Without this a correction
            // typed by hand was filed as "AI update", which is the defect the player sheet
            // had fixed in 0.5.1 and this surface still carried.
            // verbatim: what was typed is the whole value. See mergeStatValue - without it
            // an existing "120/120" puts its ceiling back on a typed "120".
            applyUpdate(updateObj, { label: 'Manual edit', verbatim: true, progressionResolved: true });
        });
        el.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                el.blur();
            }
        });
        el.addEventListener('keypress', (e) => {
            e.stopPropagation();
        });
        el.addEventListener('keyup', (e) => {
            e.stopPropagation();
        });
        el.addEventListener('input', (e) => {
            e.stopPropagation();
        });
    });

    container.querySelectorAll('.sillynpc-char-remove').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const name = el.dataset.name;
            if (removeActiveCharacter(name)) {
                const mesEl = container.closest('.mes');
                if (mesEl) redrawMessage?.(mesEl);
                // A box outside a message - the stage's - redraws from this, as do the rest.
                announceSceneChange();
            }
        });
    });
}
