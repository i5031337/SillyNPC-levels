/** Move less-used controls into a native, keyboard-accessible disclosure. */
export function foldSettings(container, label, keys) {
    const rows = keys.map(key => [...container.children]
        .find(child => child.dataset?.setting === key)).filter(Boolean);
    if (!rows.some(row => row.style.display !== 'none')) return;

    const details = document.createElement('details');
    details.className = 'sillynpc-customize';
    const summary = document.createElement('summary');
    summary.textContent = label;
    details.append(summary);
    rows[0].before(details);
    details.append(...rows);
}
