import { getSettings } from '../../core/settings.js';

export function buildHistoryNoteFields(settings, onApply) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    wrap.dataset.setting = 'statusTracker.historyNoteSkip';

    const label = document.createElement('label');
    label.className = 'sillynpc-setting-row';
    label.style.fontWeight = 'bold';
    label.textContent = 'Fields In The Note';
    wrap.append(label);

    const row = document.createElement('div');
    row.className = 'sillynpc-setting-row';
    row.style.flexWrap = 'wrap';
    row.style.gap = '10px';

    const skipped = () => (settings.historyNoteSkip || []).map(name => String(name).toLowerCase());
    for (const stat of settings.globalStats || []) {
        const name = String(stat?.name ?? '').trim();
        if (!name) continue;

        const tick = document.createElement('label');
        tick.className = 'checkbox_label';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !skipped().includes(name.toLowerCase());
        box.dataset.field = name;
        box.addEventListener('change', () => {
            const without = (settings.historyNoteSkip || [])
                .filter(other => String(other).toLowerCase() !== name.toLowerCase());
            settings.historyNoteSkip = box.checked ? without : [...without, name];
            onApply();
        });
        tick.append(box, document.createTextNode(` ${name}`));
        row.append(tick);
    }
    wrap.append(row);

    const note = document.createElement('small');
    note.className = 'notes';
    note.textContent = (settings.globalStats || []).length
        ? 'A field you untick is left out of the notes and nothing else. Untick them all and no '
            + 'notes are sent. A world field added later is included on its own.'
        : 'No world fields to show yet - add one in System Builder.';
    wrap.append(note);
    return wrap;
}

/**
 * Where the tracker box goes.
 *
 * The tracker represents the current turn and is drawn only on the last message.
 * This picker controls its position there. Old placement values remain loadable.
 */
export function buildPlacementPicker(settings, onApply) {
    const KEY = 'sillynpc-placement';
    const value = settings.renderPosition === 'top' ? 'top' : 'bottom';

    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';

    const row = document.createElement('div');
    row.className = 'sillynpc-setting-row';
    const label = document.createElement('label');
    label.className = 'sillynpc-setting-label';
    label.textContent = 'Where To Show It';

    const select = document.createElement('select');
    select.className = 'text_pole';
    select.id = KEY;
    for (const [v, text] of [
        ['bottom', 'Below the last message'],
        ['top', 'Above the last message'],
    ]) {
        const option = document.createElement('option');
        option.value = v;
        option.textContent = text;
        option.selected = v === value;
        select.appendChild(option);
    }
    select.addEventListener('change', () => {
        const st = getSettings().statusTracker;
        st.renderPosition = select.value;
        onApply();
    });

    row.append(label, select);
    wrap.appendChild(row);

    return wrap;
}
