/** Reusable NPC templates select fields from their System's shared catalogs. */
let settingsProvider = () => null;
export function setNpcTemplateSettingsProvider(provider) { settingsProvider = provider; }
export function activeNpcSystem(settings = settingsProvider()) {
    return settings?.statusTracker?.presets?.[settings.activeSystem]?.definition;
}
export function npcTemplates(system = activeNpcSystem()) {
    return system?.npcTemplates || [];
}
export function npcTemplateFor(actor, system = activeNpcSystem()) {
    const templates = npcTemplates(system);
    return templates.find(template => template.id === actor?.npcTemplateId)
        || (actor && !Object.hasOwn(actor, 'npcTemplateId') && (Object.keys(actor.stats || actor.statusOverrides || {}).length > 0
            || Object.values(actor.profile || {}).some(value => String(value || '').trim())) && system?.legacyNpcTemplateId
            ? templates.find(template => template.id === system.legacyNpcTemplateId) : null);
}
export function npcStatsFor(actor, tracker = settingsProvider()?.statusTracker, system = activeNpcSystem()) {
    const catalog = tracker?.npcStats || [];
    if (!Array.isArray(system?.npcTemplates)) return catalog;
    const template = npcTemplateFor(actor, system);
    if (!template) return [];
    const ids = new Set(template.statIds);
    const definitions = system.stats?.npc || [];
    return catalog.filter(stat => ids.has(stat.id || definitions.find(field => field.name === stat.name)?.id));
}
export function npcProfileIdsFor(actor, system = activeNpcSystem()) {
    if (!Array.isArray(system?.npcTemplates)) return null;
    return new Set(npcTemplateFor(actor, system)?.profileIds || []);
}
/** The reader may assign an unassigned NPC, but cannot change an established choice. */
export function proposedNpcTemplate(actor, proposal, system = activeNpcSystem()) {
    return npcTemplateFor(actor, system) || npcTemplates(system)
        .find(template => template.id === proposal?.npcTemplateId) || null;
}
export function describeNpcTemplates(system = activeNpcSystem(), tracker = settingsProvider()?.statusTracker) {
    if (!Array.isArray(system?.npcTemplates)) return '';
    const lines = npcTemplates(system).map(template => {
        const stats = npcStatsFor({ npcTemplateId: template.id }, tracker, system).map(stat => stat.name);
        return `- ${template.id} (${template.name}): ${template.description || 'No assignment guidance.'} Stats: ${stats.join(', ') || '(none)'}`;
    });
    return 'For each unassigned NPC, return npcTemplateId from this list when the story identifies their type; omit it if uncertain. Keep existing assignments. Use only their template’s stats.\n'
        + (lines.join('\n') || 'No NPC templates configured; leave NPC stats empty.');
}
