/**
 * The opt-in "stop suggesting this" control.
 *
 * Worded by what the row offers, because the two directions mean opposite things and one
 * shared label hid that completely: on a removal the tick used to record "this item is
 * gone for good" when every reader took it to mean "stop asking me to delete it".
 */
export function buildNeverAgain(row, change) {
    const removing = change.kind === 'item-remove';

    const wrap = document.createElement('label');
    wrap.className = 'sillynpc-review-never';
    wrap.title = removing
        ? 'Protect this item. Nothing will propose taking it away again, including a scan '
          + 'of the whole history. Reversible from the item library.'
        : 'Stop proposing this item entirely. Use it for something the character has '
          + 'genuinely finished with - a scan of the whole history will not raise it '
          + 'again. Reversible from the item library.';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = false;
    box.addEventListener('change', () => { row.dismiss = box.checked; });

    const text = document.createElement('span');
    text.textContent = removing ? 'never remove this' : 'never add this';

    wrap.append(box, text);
    return wrap;
}

