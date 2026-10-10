import { object, progressionSchema } from './contracts.js';
import { validateProgression } from './validate-definition.js';

export function progressionOwners(plan, scope) {
    if (scope === 'world') return [];
    const assigned = owner => plan.stats.character.filter(field => field.targets.includes(owner === 'player' ? 'player' : 'npc') || field.targets.includes(`template:${owner}`)).map(field => field.id);
    return [...(plan.playerProgression.enabled ? [{ id: 'player', config: plan.playerProgression, statIds: assigned('player') }] : []),
        ...plan.npcTemplates.filter(t => t.progression.enabled).map(t => ({ id: t.id, config: t.progression, statIds: assigned(t.id) }))];
}
export function catalogSchema(fields, owners) {
    return owners.length ? object({ fields, progression: object(Object.fromEntries(owners.map(owner => [owner.id, progressionSchema]))) }) : fields;
}
export function catalogFields(value, owners) { return owners.length ? value.fields : value; }
export function checkCatalogRules(value, owners, errors) {
    for (const owner of owners) {
        const config = value.progression[owner.id];
        if (!config.enabled || config.xpFieldId !== owner.config.xpFieldId || config.levelFieldId !== owner.config.levelFieldId) {
            errors.push(`progression.${owner.id}: must match planned enablement and counters`);
        }
        validateProgression(config, value.fields, `progression.${owner.id}`, errors, owner.statIds);
    }
}
export function setCatalogRules(definition, value, owners) {
    for (const owner of owners) {
        if (owner.id === 'player') definition.progression.player = value.progression[owner.id];
        else definition.npcTemplates.find(t => t.id === owner.id).progression = value.progression[owner.id];
    }
}
