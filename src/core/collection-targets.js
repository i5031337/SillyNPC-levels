import { npcTemplateFor, npcTemplates, activeNpcSystem } from './npc-templates.js';

/** Read older single targets at the boundary; new collections store a target list. */
export function collectionTargets(collection = {}) {
    const incoming = Array.isArray(collection.targets) ? collection.targets
        : collection.target === 'npc' && collection.npcTemplateId ? [`template:${collection.npcTemplateId}`]
            : [collection.target || 'all'];
    return [...new Set(incoming.flatMap(target => target === 'all' ? ['player', 'npc']
        : target === 'player' || target === 'npc' || (typeof target === 'string' && /^template:[a-z][a-z0-9_-]*$/.test(target))
            ? [target] : []))];
}

/** Omit actor only when building a schema for an entire scope, rather than one NPC. */
export function collectionAppliesTo(collection, scope, actor, system = activeNpcSystem()) {
    if (!collection || collection.retired) return false;
    const targets = collectionTargets(collection);
    if (targets.includes(scope)) return true;
    if (scope !== 'npc') return false;
    if (actor === undefined) return targets.some(target => target.startsWith('template:'));
    const template = npcTemplateFor(actor, system);
    return !!template && targets.includes(`template:${template.id}`);
}

export function collectionTargetLabel(collection, system = activeNpcSystem()) {
    return collectionTargets(collection).map(target => {
        if (target === 'player') return 'player';
        if (target === 'npc') return 'all NPCs';
        const id = target.slice(9);
        const template = npcTemplates(system).find(template => template.id === id);
        return `${template?.name || id} NPCs (npcTemplateId: ${id})`;
    }).join(' or ') || '(no targets)';
}
