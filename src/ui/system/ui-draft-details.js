/** Metadata and presentation choices that sit outside the normal Builder tabs. */
export function buildDraftDetails(context) {
    const definition = context.definition();
    const wrap = document.createElement('details'); wrap.className = 'gen-draft-details';
    const summary = document.createElement('summary'); summary.textContent = 'Description and display'; wrap.append(summary);
    const label = document.createElement('label'); label.textContent = 'System description';
    const description = document.createElement('textarea'); description.className = 'text_pole';
    description.value = definition.metadata.description; description.rows = 2; description.setAttribute('aria-label', 'System description');
    description.addEventListener('input', () => { definition.metadata.description = description.value; context.saveSettings(); });
    label.append(description); wrap.append(label);
    const layoutLabel = document.createElement('label'); layoutLabel.textContent = 'HUD layout';
    const select = document.createElement('select'); select.className = 'text_pole'; select.setAttribute('aria-label', 'HUD layout');
    for (const [value, title] of [['plate', 'Bracket Plate'], ['underline', 'Underlines'], ['pips', 'Pip Rows'], ['splitring', 'Split Ring']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = title; select.append(option);
    }
    select.value = definition.hud.layout;
    select.addEventListener('change', () => { definition.hud.layout = select.value; context.saveSettings(); });
    layoutLabel.append(select); wrap.append(layoutLabel);
    for (const [key, title] of [['showWorld', 'Show world stats'], ['showNpcPortraits', 'Show NPC portraits']]) {
        const row = document.createElement('label'); const check = document.createElement('input'); check.type = 'checkbox'; check.checked = definition.hud[key];
        check.addEventListener('change', () => { definition.hud[key] = check.checked; context.saveSettings(); });
        row.append(check, ` ${title}`); wrap.append(row);
    }
    return wrap;
}
