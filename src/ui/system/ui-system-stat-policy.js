/** Stat update authority is separate from NPC transfer persistence. */
export function statPolicyMarkup(stat, scope, numeric, escapeHtml) {
    if (scope === 'globalStats') return '';
    const name = escapeHtml(stat.name);
    const policy = stat.updatePolicy === 'advancement' ? 'advancement'
        : (!stat.updatePolicy && stat.persistence === 'innate' ? 'advancement' : 'turn');
    const canShowBonus = !['xp', 'level', 'level bonus'].includes(String(stat.name).toLowerCase())
        && (numeric || stat.advanceOnLevel
            || /^\s*-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?\s*$/.test(String(stat.defaultValue ?? '')));
    const policyHelp = scope === 'npcStats'
        ? 'Turn fields can change after a story message. Advancement fields are kept out of turn extraction and can currently be edited by hand.'
        : 'Turn fields can change after a story message. Advancement fields change through a level-up bonus or manual editing.';
    return `
        <select class="text_pole stat-update-policy"
                title="${policyHelp}"
                aria-label="${name} update policy"
                style="width:120px; font-size:var(--sillynpc-text-md); height:24px;">
            <option value="turn" ${policy === 'turn' ? 'selected' : ''}>Turn</option>
            <option value="advancement" ${policy === 'advancement' ? 'selected' : ''}>Advancement</option>
        </select>
        ${scope === 'npcStats' ? `
        <select class="text_pole stat-persistence"
                title="Innate values travel with the character. Variable values start from the destination system's default. This choice does not control turn updates."
                aria-label="${name} persistence"
                style="width:80px; font-size:var(--sillynpc-text-md); height:24px;">
            <option value="variable" ${stat.persistence !== 'innate' ? 'selected' : ''}>Variable</option>
            <option value="innate" ${stat.persistence === 'innate' ? 'selected' : ''}>Innate</option>
        </select>
        ${stat.persistenceReview ? '<small class="sillynpc-field-note">Choose how this field transfers; its values are preserved.</small>' : ''}
        ` : ''}
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
    row.querySelector('.stat-persistence')?.addEventListener('change', (event) => {
        stat.persistence = event.target.value;
        delete stat.persistenceReview;
        saveSettings();
        onRefresh();
    });
    row.querySelector('.stat-advance-on-level')?.addEventListener('change', (event) => {
        stat.advanceOnLevel = event.target.checked;
        saveSettings();
        onRefresh();
    });
}
