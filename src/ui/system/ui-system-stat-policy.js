/** NPC carryover is independent of reader locking and progression. */
export function statPolicyMarkup(stat, scope) {
    if (scope !== 'characterStats') return '';
    return `<label class="sillynpc-check-group" title="Keep this NPC stat when moving the character to a new adventure. Otherwise use the destination default.">
        <input type="checkbox" class="stat-carry-over" ${stat.carryOver ? 'checked' : ''}>
        <small>NPC carryover</small>
    </label>`;
}

export function bindStatPolicy(row, stat, saveSettings) {
    row.querySelector('.stat-carry-over')?.addEventListener('change', (event) => {
        stat.carryOver = event.target.checked;
        saveSettings();
    });
}
