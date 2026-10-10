/** Shared character catalogs use the same assignment vocabulary as collections. */
export function fieldTargets(field = {}) {
    const targets = Array.isArray(field.targets) ? field.targets : [field.target || 'all'];
    return [...new Set(targets.flatMap(target => target === 'all' ? ['player', 'npc']
        : target === 'player' || target === 'npc' || /^template:[a-z][a-z0-9_-]*$/.test(target || '') ? [target] : []))];
}
function actorTemplateId(actor, system) {
    if (Object.hasOwn(actor || {}, 'npcTemplateId')) return actor.npcTemplateId;
    return (Object.keys(actor?.stats || actor?.statusOverrides || {}).length
        || Object.values(actor?.profile || {}).some(value => String(value || '').trim())) ? system?.legacyNpcTemplateId : null;
}
export function fieldAppliesTo(field, scope, actor, system) {
    if (!field || field.retired) return false;
    const targets = fieldTargets(field);
    if (targets.includes(scope)) return true;
    if (scope !== 'npc') return false;
    if (actor === undefined) return targets.some(target => target.startsWith('template:'));
    const id = actorTemplateId(actor, system);
    return (!Array.isArray(system?.npcTemplates) || system.npcTemplates.some(template => template.id === id))
        && targets.includes(`template:${id}`);
}
export function systemStatFields(system, scope, actor) {
    if (scope === 'world') return (system?.stats?.world || []).filter(field => !field.retired);
    const fields = system?.stats?.character;
    if (!Array.isArray(fields)) return (system?.stats?.[scope] || []).filter(field => !field.retired);
    return fields.filter(field => fieldAppliesTo(field, scope, actor, system));
}
export function systemProfileFields(system, scope, actor) {
    if (!Array.isArray(system?.profiles)) return (system?.profiles?.[scope] || []).filter(field => !field.retired);
    return system.profiles.filter(field => fieldAppliesTo(field, scope, actor, system));
}
export function templateStatIds(system, template) {
    return systemStatFields(system, 'npc', { npcTemplateId: template?.id }).map(field => field.id);
}
export function templateProfileIds(system, template) {
    return systemProfileFields(system, 'npc', { npcTemplateId: template?.id }).map(field => field.id);
}

/** Definitions overlap only when at least one actor can select both. */
export function fieldsShareActor(first, second) {
    const a = fieldTargets(first), b = fieldTargets(second);
    if (a.includes('player') && b.includes('player')) return true;
    const npc = targets => targets.filter(target => target === 'npc' || target.startsWith('template:'));
    const aNpc = npc(a), bNpc = npc(b);
    return aNpc.length > 0 && bNpc.length > 0
        && (aNpc.includes('npc') || bNpc.includes('npc') || aNpc.some(target => bNpc.includes(target)));
}

export function fieldAssignmentConflicts(fields, field, { targets = field.targets, name = field.name || field.label } = {}) {
    const key = String(name || '').trim().toLowerCase();
    return (fields || []).filter(other => other !== field && !other.retired
        && String(other.name || other.label || '').trim().toLowerCase() === key
        && fieldsShareActor({ targets }, other));
}
