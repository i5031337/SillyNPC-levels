/** Stat update policy also determines whether an NPC value travels. */
export function statPolicyMarkup(stat, scope, numeric, escapeHtml) {
    if (scope === 'globalStats') return '';
    const name = escapeHtml(stat.name);
    const policy = stat.updatePolicy === 'advancement' ? 'advancement'
        : (!stat.updatePolicy && stat.persistence === 'innate' ? 'advancement' : 'turn');
    const canShowBonus = !['xp', 'level', 'level bonus'].includes(String(stat.name).toLowerCase())
        && (numeric || stat.advanceOnLevel
            || /^\s*-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?\s*$/.test(String(stat.defaultValue ?? '')));
    const policyHelp = scope === 'npcStats'
        ? 'Turn fields can change after a story message and reset in a new adventure. Advancement fields travel with the character and can be edited by hand. Locked fields also travel.'
        : 'Turn fields can change after a story message. Advancement fields change through a level-up bonus or manual editing.';
    return `
        <select class="text_pole stat-update-policy"
                title="${policyHelp}"
                aria-label="${name} update policy"
                style="width:120px; font-size:var(--sillynpc-text-md); height:24px;">
            <option value="turn" ${policy === 'turn' ? 'selected' : ''}>Turn</option>
            <option value="advancement" ${policy === 'advancement' ? 'selected' : ''}>Advancement</option>
        </select>
        ${scope === 'playerStats' && canShowBonus ? `
        <label class="sillynpc-check-group" title="Allow a level-up bonus to raise this stat. A Turn stat can also receive an advancement bonus to its maximum.">
            <input type="checkbox" class="stat-advance-on-level" ${stat.advanceOnLevel ? 'checked' : ''}>
            <small>Level bonus</small>
        </label>` : ''}
    `;
}

export function bindStatPolicy(row, stat, saveSettings, onRefresh) {
    row.querySelector('.stat-update-policy')?.addEventListener('change', (event) => {
        stat.updatePolicy = event.target.value;
        saveSettings();
        onRefresh();
    });
    row.querySelector('.stat-advance-on-level')?.addEventListener('change', (event) => {
        stat.advanceOnLevel = event.target.checked;
        saveSettings();
        onRefresh();
    });
}
