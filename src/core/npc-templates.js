import { systemStatFields, systemProfileFields } from './system-fields.js';
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
    const definitions = systemStatFields(system, 'npc', actor);
    const ids = new Set(Array.isArray(system.stats?.character) ? definitions.map(field => field.id) : template?.statIds || []);
    return catalog.filter(stat => ids.has(stat.id || definitions.find(field => field.name === stat.name)?.id));
}
export function npcProfileIdsFor(actor, system = activeNpcSystem()) {
    if (!Array.isArray(system?.npcTemplates)) return null;
    return new Set(Array.isArray(system.profiles) ? systemProfileFields(system, 'npc', actor).map(field => field.id)
        : npcTemplateFor(actor, system)?.profileIds || []);
}
/** The reader may assign an unassigned NPC, but cannot change an established choice. */
export function proposedNpcTemplate(actor, proposal, system = activeNpcSystem()) {
    const templates = npcTemplates(system);
    return npcTemplateFor(actor, system)
        || templates.find(template => template.id === proposal?.npcTemplateId)
        || (!proposal?.npcTemplateId && templates.length === 1 ? templates[0] : null);
}
export function describeNpcTemplates(system = activeNpcSystem(), tracker = settingsProvider()?.statusTracker) {
    if (!Array.isArray(system?.npcTemplates)) return '';
    if (!npcTemplates(system).length) return 'No NPC templates configured; omit npcTemplateId. Use fields assigned to all NPCs.';
    if (npcTemplates(system).length === 1) {
        const template = npcTemplates(system)[0];
        const stats = npcStatsFor({ npcTemplateId: template.id }, tracker, system).map(stat => stat.name);
        return `NPC fields: ${stats.join(', ') || '(none)'}.${template.description ? ` NPC guidance: ${template.description}` : ''}`;
    }
    const lines = npcTemplates(system).map(template => {
        const stats = npcStatsFor({ npcTemplateId: template.id }, tracker, system).map(stat => stat.name);
        return `- ${template.id} (${template.name}): ${template.description || 'No assignment guidance.'} Stats: ${stats.join(', ') || '(none)'}`;
    });
    return 'For each unassigned NPC, return npcTemplateId from this list when the story identifies their type; omit it if uncertain. Keep existing assignments. Use only their template’s stats.\n'
        + lines.join('\n');
}
