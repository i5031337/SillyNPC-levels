import { array, object, profileSchema, statSchema, collectionSchema, rewardSchema } from './contracts.js';
import { validateFields, validateCollections } from './validate-definition.js';
import { progressionOwners, catalogSchema, catalogFields, checkCatalogRules, setCatalogRules } from './catalog-rules.js';
const without = (schema, keys) => object(Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !keys.includes(key))), schema.required.filter(key => !keys.includes(key)));
export function buildStages(plan) {
    const stages = [];
    const add = stage => stages.push(stage);
    for (const kind of ['profiles', 'stats']) for (const scope of Object.keys(plan[kind])) {
        const planned = plan[kind][scope]; if (!planned.length) continue;
        const owners = kind === 'stats' ? progressionOwners(plan, scope) : [];
        const fields = array(kind === 'profiles' ? profileSchema : without(statSchema, ['advanceOnLevel', 'isPrimary', ...(scope === 'npc' ? [] : ['carryOver'])]));
        add({ id: `${kind}.${scope}`, label: `Defining ${scope} ${kind}${owners.length ? ' and progression' : ''}`, schema: catalogSchema(fields, owners),
            expected: planned, owners, fields: value => catalogFields(value, owners), dependencies: [],
            get: d => owners.length ? { fields: d[kind][scope], progression: Object.fromEntries(owners.map(owner => [owner.id,
                scope === 'player' ? d.progression.player : d.npcTemplates.find(t => t.id === owner.id).progression])) } : d[kind][scope],
            set: (d, value) => { d[kind][scope] = catalogFields(value, owners); setCatalogRules(d, value, owners, scope); },
            check: (value, d, errors) => {
                validateFields(catalogFields(value, owners), `${kind}.${scope}`, errors, kind === 'profiles' ? 'profile' : 'stat');
                checkCatalogRules(value, owners, scope, errors);
            } });
    }
    // Catalogs precede collections; requests need only the selected template context.
    for (const col of plan.collections) add({ id: `collection.${col.id}`, label: `Defining collection ${col.name}`,
        schema: without(collectionSchema, ['levelUpRewards']), expected: [col], dependencies: [],
        get: d => d.collections.find(c => c.id === col.id),
        set: (d, value) => { d.collections = [...d.collections.filter(c => c.id !== col.id), value]; },
        check: (value, d, errors) => {
            coverage(value.fields, col.fields, errors);
            if (JSON.stringify([...value.targets].sort()) !== JSON.stringify([...col.targets].sort())) errors.push('targets: must match planned targets');
            validateCollections([value], d.npcTemplates, errors);
        } });
    for (const col of plan.collections.filter(c => c.rewards !== 'none')) add({ id: `rewards.${col.id}`, label: `Defining rewards for ${col.name}`,
        schema: rewardSchema, dependencies: [`collection.${col.id}`, ...stages.filter(s =>
            (s.id === 'stats.player' && col.targets.includes('player'))
            || (s.id === 'stats.npc' && col.targets.some(target => target !== 'player'))).map(s => s.id)],
        get: d => d.collections.find(c => c.id === col.id).levelUpRewards,
        set: (d, value) => { d.collections.find(c => c.id === col.id).levelUpRewards = value; },
        check: (value, d, errors) => {
            if (!value.enabled || value.mode !== col.rewards) errors.push('rewards: must match planned mode');
            validateCollections([{ ...d.collections.find(c => c.id === col.id), levelUpRewards: value }], d.npcTemplates, errors);
            const targets = col.targets;
            if (!(targets.includes('player') && d.progression.player.enabled) && !d.npcTemplates.some(t => t.progression.enabled && (targets.includes('npc') || targets.includes(`template:${t.id}`)))) errors.push('rewards: requires a target with enabled progression');
        } });
    return stages;
}
export function applyDisplayDefaults(definition) {
    for (const scope of ['world', 'player', 'npc']) {
        definition.hud[`${scope}StatIds`] = definition.stats[scope].filter(field => !field.retired && field.visible !== false).map(field => field.id);
    }
    definition.stats.player.forEach(stat => { stat.isPrimary = definition.hud.playerStatIds.includes(stat.id); });
}
export function coverage(value, expected, errors) {
    const items = Array.isArray(value) ? value : [value];
    if (items.length !== expected.length || new Set(items.map(item => item.id)).size !== items.length) errors.push(`section: must contain each planned object exactly once; expected IDs: ${expected.map(field => field.id).join(', ')}; received IDs: ${items.map(item => item.id).join(', ')}`);
    for (const item of items) if (!expected.some(field => field.id === item.id)) errors.push(`section: unplanned or changed ID ${item.id}; allowed IDs: ${expected.map(field => field.id).join(', ')}`);
    for (const field of expected) if (!items.some(item => item.id === field.id)) errors.push(`section: missing planned ID ${field.id} (${field.name})`);
}
