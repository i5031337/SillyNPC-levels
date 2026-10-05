/** Stat update policy also determines whether an NPC value travels. */
export function statPolicyMarkup(stat, scope, escapeHtml) {
    if (scope === 'globalStats') return '';
    const name = escapeHtml(stat.name);
    const policy = stat.updatePolicy === 'advancement' ? 'advancement'
        : (!stat.updatePolicy && stat.persistence === 'innate' ? 'advancement' : 'turn');
    const policyHelp = scope === 'npcStats'
        ? 'Turn fields can change after a story message and reset in a new adventure. Only Turn maxima can grow on level-up. Advancement fields travel with the character and keep a fixed range.'
        : 'Turn fields can change after a story message, and level growth can raise a Turn maximum. Advancement ratings change through a level-up bonus or manual edit but keep their fixed range.';
    return `
        <select class="text_pole stat-update-policy"
                title="${policyHelp}"
                aria-label="${name} update policy"
                style="width:120px; font-size:var(--sillynpc-text-md); height:24px;">
            <option value="turn" ${policy === 'turn' ? 'selected' : ''}>Turn</option>
            <option value="advancement" ${policy === 'advancement' ? 'selected' : ''}>Advancement</option>
        </select>
    `;
}

export function bindStatPolicy(row, stat, saveSettings, onRefresh) {
    row.querySelector('.stat-update-policy')?.addEventListener('change', (event) => {
        stat.updatePolicy = event.target.value;
        saveSettings();
        onRefresh();
    });
}
