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
    for (const [fields, path] of [[plan.profiles, 'profiles'], [plan.stats.world, 'stats.world'], [plan.stats.character, 'stats.character']]) checkNames(fields, path);
    plan.profiles = allocate(plan.profiles);
    for (const scope of ['world', 'character']) plan.stats[scope] = allocate(plan.stats[scope]);
    if (plan.npcTemplates.some(t => ['player', 'npc'].includes(t.name.trim().toLowerCase()))) errors.push('npcTemplates: player and npc are reserved target names');
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
    const assignTargets = (field, path) => {
        field.targets = field.targets.map(target => ['player', 'npc'].includes(target) ? target
            : `template:${resolve(target, plan.npcTemplates, `${path}.targets`, 'npcTemplates')}`);
        if (!field.targets.length || new Set(field.targets).size !== field.targets.length) errors.push(`${path}.targets: select unique targets`);
    };
    plan.profiles.forEach(field => assignTargets(field, `profiles.${field.name}`));
    plan.stats.character.forEach(field => assignTargets(field, `stats.character.${field.name}`));
    const forOwner = owner => plan.stats.character.filter(field => field.targets.includes(owner === 'player' ? 'player' : 'npc') || field.targets.includes(`template:${owner}`));
    plan.playerProgression = progression(plan.playerProgression, forOwner('player'), 'playerProgression', 'stats.character assigned to player');
    for (const template of plan.npcTemplates) template.progression = progression(template.progression,
        forOwner(template.id), `template.${template.name}.progression`, 'stats.character assigned to this template');
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
    const definition = normalizeSystemDefinition({ schemaVersion: 2, id: slug(plan.name), name: plan.name,
        metadata: { description: plan.description, author: 'Generated' }, memories: plan.memories, profiles: [],
        stats: { world: [], character: [] }, npcTemplates: [], collections: [],
        progression: { player: disabledProgression() } });
    // Preserve template identities while catalog stages are still pending.
    definition.npcTemplates = plan.npcTemplates.map(t => ({ id: t.id, name: t.name, description: t.description,
        progression: disabledProgression() }));
    return definition;
}
