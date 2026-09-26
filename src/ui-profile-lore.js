/** Show named lore sections with the same labels and values as profile fields. */
export function renderLoreBlocks(text, container) {
    const sections = [];
    for (const line of String(text ?? '').split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z][A-Za-z &]+):\s*(.*)$/);
        if (match) sections.push({ label: match[1], value: match[2] });
        else if (line.trim()) {
            if (sections.length) sections.at(-1).value += `\n${line}`;
            else sections.push({ label: 'Additional lore', value: line });
        }
    }
    for (const section of sections) {
        const wrap = document.createElement('div');
        wrap.className = 'sillynpc-cv-block';
        const label = document.createElement('div');
        label.className = 'sillynpc-cv-label';
        label.textContent = section.label;
        const value = document.createElement('div');
        value.className = 'sillynpc-cv-value';
        value.textContent = section.value;
        wrap.append(label, value);
        container.append(wrap);
    }
}
