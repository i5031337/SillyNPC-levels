import { escapeHtml } from './utils.js';

export function choiceEntries(options, current) {
    const allowed = (options || []).map(v => String(v ?? '').trim()).filter(Boolean);
    const value = String(current ?? '').trim();

    const entries = [{ value: '', label: '(default)', selected: value === '' }];
    for (const allowedValue of allowed) {
        entries.push({ value: allowedValue, label: allowedValue, selected: allowedValue === value });
    }
    if (value && !allowed.includes(value)) {
        entries.push({ value, label: `${value} (no longer allowed)`, selected: true });
    }
    return entries;
}

/** The same list as DOM, for the editors that build elements. */
export function buildChoiceSelect(options, current) {
    const select = document.createElement('select');
    select.className = 'text_pole sillynpc-choice-select';
    for (const entry of choiceEntries(options, current)) {
        const option = document.createElement('option');
        option.value = entry.value;
        option.textContent = entry.label;
        select.append(option);
    }
    select.value = String(current ?? '').trim();
    return select;
}

/** The same list as markup, for the editors that build HTML strings. */
export function choiceOptionsHtml(options, current) {
    return choiceEntries(options, current)
        .map(entry => `<option value="${escapeHtml(entry.value)}"${entry.selected ? ' selected' : ''}>`
            + `${escapeHtml(entry.label)}</option>`)
        .join('');
}

/** Whether this definition restricts what it may hold. */
export function isChoiceField(def) {
    return (def?.options || []).some(v => String(v ?? '').trim());
}

