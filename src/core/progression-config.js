/** Canonical, actor-independent progression configuration. IDs survive field renames. */
const numericValue = value => /^\s*-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?\s*$/.test(String(value ?? ''));
export function progressionStatEligible(stat, config = {}) {
    return Boolean(stat && !stat.retired && !stat.locked
        && ![config.xpFieldId, config.levelFieldId].includes(stat.id)
        && !['xp', 'level', 'level bonus'].includes(String(stat.name).toLowerCase())
        && (stat.type === 'number' || stat.type === 'bar' || numericValue(stat.defaultValue)));
}
export function progressionFieldId(stat) {
    return stat?.id || String(stat?.name || '').toLowerCase().normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
export function normalizeProgressionConfig(source, stats = [], { enabledByDefault = false, statIds } = {}) {
    stats = stats.map(stat => stat.id ? stat : { ...stat, id: progressionFieldId(stat) });
    const input = source && typeof source === 'object' ? source : {};
    const fields = statIds ? stats.filter(stat => statIds.includes(stat.id)) : stats;
    const resolve = (key, name) => typeof input[key] === 'string' ? input[key]
        : fields.find(stat => String(stat.name).toLowerCase() === name)?.id || '';
    const xpFieldId = resolve('xpFieldId', 'xp');
    const levelFieldId = resolve('levelFieldId', 'level');
    const validFields = xpFieldId !== levelFieldId && [xpFieldId, levelFieldId].every(id => id && fields.some(stat =>
        stat.id === id && !stat.retired && (stat.type === 'number' || stat.type === 'bar' || numericValue(stat.defaultValue))));
    const requested = Array.isArray(input.statIds) ? input.statIds
        : Array.isArray(input.bonusStatIds) ? input.bonusStatIds : fields.filter(stat => stat.advanceOnLevel).map(stat => stat.id);
    const config = { xpFieldId, levelFieldId };
    const selected = [...new Set(requested)].filter(id => progressionStatEligible(fields.find(stat => stat.id === id), config));
    return {
        enabled: validFields && (input.enabled === undefined ? enabledByDefault : input.enabled === true),
        xpFieldId, levelFieldId,
        statGrowth: ['none', 'one', 'all'].includes(input.statGrowth) ? input.statGrowth : selected.length ? 'one' : 'none',
        statIds: selected,
    };
}
/** Resolve live tracker configuration; template opt-in never inherits player behavior. */
export function resolveProgressionConfig(tracker, { isPlayer = false, templateId, template } = {}) {
    if (isPlayer) return normalizeProgressionConfig(tracker?.progression?.player, tracker?.playerStats || [], { enabledByDefault: true });
    const owner = template || tracker?.npcTemplates?.find(item => item.id === templateId);
    return normalizeProgressionConfig(owner?.progression, tracker?.npcStats || [], { statIds: owner?.statIds || [] });
}

/** Assign canonical IDs/config at loading boundaries without touching character values. */
export function normalizeTrackerProgression(tracker, system) {
    if (!tracker) return;
    for (const scope of ['player', 'npc']) {
        const stats = tracker[`${scope}Stats`] || [];
        stats.forEach(stat => { stat.id ||= system?.stats?.[scope]?.find(field => field.name === stat.name)?.id || progressionFieldId(stat); });
    }
    tracker.progression ||= structuredClone(system?.progression || {});
    tracker.progression.player = normalizeProgressionConfig(tracker.progression.player, tracker.playerStats, { enabledByDefault: true });
    if (system?.npcTemplates) tracker.npcTemplates = system.npcTemplates;
    for (const template of tracker.npcTemplates || []) {
        template.progression = normalizeProgressionConfig(template.progression, tracker.npcStats, { statIds: template.statIds });
        if (!template.progression.enabled) continue;
        const level = tracker.npcStats.find(stat => stat.id === template.progression.levelFieldId);
        if (level) level.updatePolicy = 'advancement';
        const field = system?.stats?.npc?.find(stat => stat.id === template.progression.levelFieldId);
        if (field) field.updatePolicy = 'advancement';
    }
}
