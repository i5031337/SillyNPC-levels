import { array, object, profileSchema, statSchema, characterStatSchema, collectionSchema, rewardSchema } from './contracts.js';
import { validateFields, validateCollections } from './validate-definition.js';
import { progressionOwners, catalogSchema, catalogFields, checkCatalogRules, setCatalogRules } from './catalog-rules.js';
const without = (schema, keys) => object(Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !keys.includes(key))), schema.required.filter(key => !keys.includes(key)));
export function buildStages(plan) {
    const stages = [];
    const add = stage => stages.push(stage);
    const catalogs = [['profiles', null, plan.profiles], ...Object.entries(plan.stats).map(([scope, fields]) => ['stats', scope, fields])];
    for (const [kind, scope, planned] of catalogs) {
        if (!planned.length) continue;
        const owners = kind === 'stats' ? progressionOwners(plan, scope) : [];
        const fields = array(kind === 'profiles' ? without(profileSchema, ['legacyId']) : without(scope === 'character' ? characterStatSchema : statSchema, ['isPrimary', ...(scope === 'world' ? ['carryOver'] : [])]));
        const id = scope ? `${kind}.${scope}` : kind;
        const getFields = d => scope ? d[kind][scope] : d[kind];
        add({ id, label: `Defining ${scope || 'shared'} ${kind}${owners.length ? ' and progression' : ''}`, schema: catalogSchema(fields, owners),
            expected: planned, owners, fields: value => catalogFields(value, owners), dependencies: [],
            get: d => owners.length ? { fields: getFields(d), progression: Object.fromEntries(owners.map(owner => [owner.id,
                owner.id === 'player' ? d.progression.player : d.npcTemplates.find(t => t.id === owner.id).progression])) } : getFields(d),
            set: (d, value) => { if (scope) d[kind][scope] = catalogFields(value, owners); else d[kind] = catalogFields(value, owners); setCatalogRules(d, value, owners); },
            check: (value, d, errors) => {
                const actual = catalogFields(value, owners);
                validateFields(actual, id, errors, kind === 'profiles' ? 'profile' : 'stat');
                for (const field of actual) {
                    const expected = planned.find(item => item.id === field.id);
                    if (expected?.targets && JSON.stringify([...field.targets].sort()) !== JSON.stringify([...expected.targets].sort())) errors.push(`${id}.${field.id}.targets: must match planned targets`);
                }
                checkCatalogRules(value, owners, errors);
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
        schema: rewardSchema, dependencies: [`collection.${col.id}`, ...stages.filter(s => s.id === 'stats.character').map(s => s.id)],
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
    const fields = definition.stats.character.filter(field => !field.retired && field.visible !== false);
    definition.hud.worldStatIds = definition.stats.world.filter(field => !field.retired && field.visible !== false).map(field => field.id);
    definition.hud.playerStatIds = fields.filter(field => field.targets.includes('player')).map(field => field.id);
    definition.hud.npcStatIds = fields.filter(field => field.targets.some(target => target !== 'player')).map(field => field.id);
    fields.forEach(stat => { stat.isPrimary = definition.hud.playerStatIds.includes(stat.id); });
}
export function coverage(value, expected, errors) {
    const items = Array.isArray(value) ? value : [value];
    if (items.length !== expected.length || new Set(items.map(item => item.id)).size !== items.length) errors.push(`section: must contain each planned object exactly once; expected IDs: ${expected.map(field => field.id).join(', ')}; received IDs: ${items.map(item => item.id).join(', ')}`);
    for (const item of items) if (!expected.some(field => field.id === item.id)) errors.push(`section: unplanned or changed ID ${item.id}; allowed IDs: ${expected.map(field => field.id).join(', ')}`);
    for (const field of expected) if (!items.some(item => item.id === field.id)) errors.push(`section: missing planned ID ${field.id} (${field.name})`);
}
