import { planSchema } from './contracts.js';
import { validateShape } from './validate-shape.js';
import { normalizeSystemDefinition } from '../core/system-schema.js';
export const disabledProgression = () => ({ enabled: false, xpFieldId: '', levelFieldId: '', pointsPerLevel: 0, assignment: 'random', statIds: [] });
const slug = name => {
    const base = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 65) || 'field';
    return /^[a-z]/.test(base) ? base : `f-${base}`;
};
function allocate(fields) {
    const used = new Set();
    return fields.map(field => {
        const base = slug(field.name); let id = base;
        for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
        used.add(id); return { ...field, id };
    });
}
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}
export function allocatePlan(source) {
    const errors = validateShape(source, planSchema);
    if (errors.length) throw new Error(errors.join('\n'));
    const plan = structuredClone(source);
    const checkNames = (fields, path) => {
        const names = fields.map(field => field.name.trim().toLowerCase());
        if (names.some(name => !name) || new Set(names).size !== names.length) errors.push(`${path}: names must be nonblank and unambiguous`);
    };
    if (!plan.name.trim()) errors.push('plan.name: required');
    for (const [key, scopes] of [['profiles', ['player', 'npc']], ['stats', ['world', 'player', 'npc']]]) {
        for (const scope of scopes) { checkNames(plan[key][scope], `${key}.${scope}`); plan[key][scope] = allocate(plan[key][scope]); }
    }
    checkNames(plan.npcTemplates, 'npcTemplates'); checkNames(plan.collections, 'collections');
    plan.npcTemplates = allocate(plan.npcTemplates); plan.collections = allocate(plan.collections);
    const resolve = (name, fields, path, catalog) => {
        const field = fields.find(field => field.name.trim().toLowerCase() === name.trim().toLowerCase());
        if (!field) errors.push(`${path}: unresolved name ${JSON.stringify(name)}. Use a field name from ${catalog}; available names: ${fields.map(field => JSON.stringify(field.name)).join(', ') || '(none)'}.`);
        return field?.id || '';
    };
    const progression = (config, fields, path, catalog) => {
        if (!config.enabled) return { ...config, xpFieldId: '', levelFieldId: '' };
        const xpFieldId = resolve(config.xp, fields, `${path}.xp`, catalog), levelFieldId = resolve(config.level, fields, `${path}.level`, catalog);
        if (xpFieldId && xpFieldId === levelFieldId) errors.push(`${path}: XP and Level must be distinct`);
        return { ...config, xpFieldId, levelFieldId };
    };
    plan.playerProgression = progression(plan.playerProgression, plan.stats.player, 'playerProgression', 'stats.player');
    for (const template of plan.npcTemplates) {
        template.profileIds = template.profiles.map(name => resolve(name, plan.profiles.npc, `template.${template.name}.profiles`, 'profiles.npc'));
        template.statIds = template.stats.map(name => resolve(name, plan.stats.npc, `template.${template.name}.stats`, 'stats.npc'));
        if ([template.profileIds, template.statIds].some(ids => new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length)) errors.push(`template.${template.name}: duplicate memberships`);
        template.progression = progression(template.progression, plan.stats.npc.filter(field => template.statIds.includes(field.id)), `template.${template.name}.progression`, 'stats.npc selected by this template');
    }
    for (const collection of plan.collections) {
        checkNames(collection.fields, `collection.${collection.name}.fields`);
        if (!collection.fields.length) errors.push(`collection.${collection.name}: requires identifier field first`);
        if (collection.trackQuantity && !collection.fields.some(field => field.name.toLowerCase() === 'quantity'))
            collection.fields.push({ name: 'quantity', purpose: 'Built-in amount held; gains and consumption use add/remove amounts.' });
        collection.fields = allocate(collection.fields);
        collection.targets = collection.targets.map(target => ['player', 'npc'].includes(target) ? target : `template:${resolve(target, plan.npcTemplates, `collection.${collection.name}.targets`, 'npcTemplates')}`);
        if (!collection.targets.length || new Set(collection.targets).size !== collection.targets.length) errors.push(`collection.${collection.name}: select unique targets`);
    }
    if (errors.length) throw new Error(errors.join('\n'));
    return freeze(plan);
}
export function emptyDefinition(plan) {
    const definition = normalizeSystemDefinition({ schemaVersion: 1, id: slug(plan.name), name: plan.name,
        metadata: { description: plan.description, author: 'Generated' }, memories: plan.memories, profiles: { player: [], npc: [] },
        stats: { world: [], player: [], npc: [] }, npcTemplates: [], collections: [],
        progression: { player: disabledProgression(), npc: disabledProgression() } });
    // Catalogs are still empty; normalization would strip the frozen memberships.
    definition.npcTemplates = plan.npcTemplates.map(t => ({ id: t.id, name: t.name, description: t.description,
        profileIds: [...t.profileIds], statIds: [...t.statIds], progression: disabledProgression() }));
    return definition;
}
