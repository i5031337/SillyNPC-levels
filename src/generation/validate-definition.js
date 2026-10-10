import { fieldAssignmentConflicts, systemStatFields } from '../core/system-fields.js';
import { collectionQuantityField } from '../core/collection-fields.js';
import { definitionSchema, LIMITS } from './contracts.js';
import { validateShape } from './validate-shape.js';
import { normalizeSystemDefinition } from '../core/system-schema.js';
import { progressionStatEligible } from '../core/progression-config.js';
import { validateRewardEntry, collectionRewardAppliesTo, rewardIdentifier } from '../core/collection-rewards.js';

const numeric = /^-?\d+(?:\.\d+)?$/;
export function numberParts(value) {
    const parts = String(value).trim().split('/').map(part => part.trim());
    return parts.length <= 2 && parts.every(part => numeric.test(part)) ? parts.map(Number) : null;
}
function unique(items, key, path, errors) {
    const used = new Set();
    items.forEach((item, i) => {
        const value = typeof item === 'string' ? item : item[key];
        if (!String(value ?? '').trim()) errors.push(`${path}[${i}].${key}: must not be blank`);
        if (used.has(value)) errors.push(`${path}[${i}].${key}: duplicate ${value}`);
        used.add(value);
    });
}
function refs(ids, fields, path, errors) {
    unique(ids, 'id', path, errors);
    ids.forEach((id, i) => { if (!fields.some(field => field.id === id && !field.retired)) errors.push(`${path}[${i}]: unresolved or retired field ${id}`); });
}
function bounds(field, path, errors) {
    const min = field.min ?? '', max = field.maxStatValue ?? '';
    for (const [key, value] of [['min', min], ['maxStatValue', max]]) {
        if (value !== '' && (!numeric.test(value) || !Number.isFinite(Number(value)))) errors.push(`${path}.${key}: expected a finite number or blank`);
    }
    if (min !== '' && max !== '' && Number(min) > Number(max)) errors.push(`${path}: minimum exceeds maximum`);
    return [min === '' ? -Infinity : Number(min), max === '' ? Infinity : Number(max)];
}
export function validateFields(fields, path, errors, kind = 'stat') {
    unique(fields, 'id', path, errors);
    const key = kind === 'profile' ? 'label' : 'name';
    fields.forEach((field, index) => {
        if (!String(field[key] ?? '').trim()) errors.push(`${path}[${index}].${key}: must not be blank`);
        if (!field.retired && fieldAssignmentConflicts(fields.slice(0, index), field, { name: field[key] }).length)
            errors.push(`${path}[${index}].${key}: duplicate ${field[key]} for overlapping targets`);
    });
    fields.forEach((field, i) => {
        const p = `${path}[${i}]`;
        if (kind === 'profile') return;
        if (field.options) unique(field.options, 'value', `${p}.options`, errors);
        if (field.type === 'number') {
            const [min, max] = bounds(field, p, errors);
            const parts = numberParts(field.defaultValue);
            if (!parts || !parts.every(Number.isFinite) || (kind === 'collection' && parts.length !== 1)) errors.push(`${p}.defaultValue: invalid numeric default`);
            else if (parts[0] < min || parts[0] > max || (parts.length === 2
                && (parts[1] <= 0 || parts[0] > parts[1] || parts[1] > max || parts[1] < min))) errors.push(`${p}.defaultValue: outside bounds or invalid pool capacity`);
            if (field.options?.length) errors.push(`${p}.options: numbers cannot have text options`);
        } else if (field.type === 'boolean') {
            if (![true, false, 'true', 'false', ''].includes(field.defaultValue)) errors.push(`${p}.defaultValue: expected boolean or blank`);
        } else {
            if (typeof field.defaultValue !== 'string') errors.push(`${p}.defaultValue: expected text`);
            if (field.options?.length && field.defaultValue !== '' && !field.options.includes(field.defaultValue)) errors.push(`${p}.defaultValue: not an allowed option`);
        }
        if (kind === 'collection' && field.isPrimary && field.isStatic !== true) errors.push(`${p}.isStatic: identifiers must be static`);
        if (kind === 'collection' && field.type === 'number' && !field.isPrimary && field.isStatic) errors.push(`${p}.isStatic: numeric values must be personal`);
        if (kind !== 'stat') return;
        if (/level bonus/i.test(field.name)) errors.push(`${p}.name: Level Bonus is not a narrative stat`);
        if (field.maxLength !== undefined && field.maxLength !== '' && (!Number.isSafeInteger(Number(field.maxLength)) || Number(field.maxLength) < 1)) errors.push(`${p}.maxLength: expected a positive integer or blank`);
        if (field.format !== undefined && !['{{name}}: {{value}}', '{{value}}'].includes(field.format)) errors.push(`${p}.format: choose name and value or value only`);
        if (field.color && !/^#[0-9a-f]{6}$/i.test(field.color)) errors.push(`${p}.color: expected a hex color`);
    });
}
export function validateProgression(config, stats, path, errors, selections) {
    const fields = selections ? stats.filter(field => selections.includes(field.id)) : stats;
    if (!config.enabled) return;
    if (config.xpFieldId === config.levelFieldId) errors.push(`${path}: XP and Level must be distinct`);
    const xp = fields.find(field => field.id === config.xpFieldId);
    const level = fields.find(field => field.id === config.levelFieldId);
    for (const [label, field] of [['XP', xp], ['Level', level]]) {
        if (!field || field.retired || (label === 'XP' && field.locked) || field.type !== 'number') errors.push(`${path}: ${label} requires a selected usable numeric field`);
    }
    const xpValue = xp && numberParts(xp.defaultValue);
    const levelValue = level && numberParts(level.defaultValue);
    if (!xpValue || xpValue.length !== 2 || !Number.isSafeInteger(xpValue[1]) || xpValue[1] <= 0
        || xpValue[0] < 0 || xpValue[0] >= xpValue[1] || !Number.isSafeInteger(xpValue[0])) errors.push(`${path}: XP field ${config.xpFieldId} defaultValue ${JSON.stringify(xp?.defaultValue)} needs an integer remainder/capacity string such as "0/100"`);
    if (xp && (!xpValue || String(xp.maxStatValue) !== String(xpValue[1]))) errors.push(`${path}: XP field ${config.xpFieldId} maxStatValue ${JSON.stringify(xp.maxStatValue)} must match its fixed capacity ("0/100" requires "100")`);
    if (!levelValue || levelValue.length !== 1 || !Number.isSafeInteger(levelValue[0]) || levelValue[0] < 1) errors.push(`${path}: starting Level must be an integer of at least one`);
    refs(config.statIds, fields, `${path}.statIds`, errors);
    if (config.pointsPerLevel > 0 && !config.statIds.length) errors.push(`${path}.statIds: choose growth candidates`);
    for (const id of config.statIds) {
        if (!progressionStatEligible(fields.find(field => field.id === id), config)) errors.push(`${path}.statIds: ineligible growth field ${id}`);
    }
}
export function validateCollections(collections, templates, errors) {
    unique(collections, 'id', 'collections', errors);
    collections.forEach((col, i) => {
        const p = `collections[${i}]`;
        if (!col.name.trim()) errors.push(`${p}.name: required`);
        validateFields(col.fields, `${p}.fields`, errors, 'collection');
        if (col.trackQuantity) {
            const quantity = collectionQuantityField(col);
            if (!quantity || quantity.isStatic || Number(quantity.defaultValue) !== 1
                || quantity.min !== '0' || quantity.maxStatValue !== '' || quantity.retired)
                errors.push(`${p}: built-in quantity requires a personal numeric field, default 1, minimum 0 and open maximum`);
        }
        if (!col.fields.length || !col.fields[0].isPrimary || col.fields.filter(field => field.isPrimary).length !== 1
            || col.fields[0].retired) errors.push(`${p}.fields: exactly one active identifier, pinned first, is required`);
        unique(col.targets, 'target', `${p}.targets`, errors);
        if (!col.targets.length) errors.push(`${p}.targets: select at least one target`);
        for (const target of col.targets) if (!['player', 'npc'].includes(target) && !templates.some(t => target === `template:${t.id}`)) errors.push(`${p}.targets: unresolved target ${target}`);
        const rewards = col.levelUpRewards;
        if (!rewards) return;
        unique(rewards.schedule, 'id', `${p}.levelUpRewards.schedule`, errors);
        const rewardNames = rewards.schedule.map(row => rewardIdentifier(col, row.entry));
        if (new Set(rewardNames).size !== rewardNames.length) errors.push(`${p}.levelUpRewards.schedule: duplicate reward identifiers`);
        for (const [index, row] of rewards.schedule.entries()) {
            for (const key of Object.keys(row.entry)) if (!col.fields.some(field => !field.retired && field.id === key)) errors.push(`${p}.levelUpRewards.schedule[${index}].entry.${key}: unknown field ID`);
            errors.push(...validateRewardEntry(col, row.entry).errors.map(error => `${p}.levelUpRewards.schedule[${index}]: ${error}`));
        }
    });
}
export function validateDefinition(definition) {
    if (JSON.stringify(definition)?.length > LIMITS.definitionChars) return ['definition: too large'];
    const errors = validateShape(definition, definitionSchema);
    if (errors.length) return errors;
    if (!definition.name.trim()) errors.push('name: required');
    validateFields(definition.profiles, 'profiles', errors, 'profile');
    for (const scope of ['world', 'character']) validateFields(definition.stats[scope], `stats.${scope}`, errors);
    for (const [path, fields] of [['profiles', definition.profiles], ['stats.character', definition.stats.character]]) {
        for (const field of fields) {
            unique(field.targets, 'target', `${path}.${field.id}.targets`, errors);
            for (const target of field.targets) if (!['player', 'npc'].includes(target) && !definition.npcTemplates.some(t => target === `template:${t.id}`)) errors.push(`${path}.${field.id}.targets: unresolved target ${target}`);
        }
    }
    unique(definition.npcTemplates, 'id', 'npcTemplates', errors);
    definition.npcTemplates.forEach((template, i) => {
        const p = `npcTemplates[${i}]`;
        if (!template.name.trim()) errors.push(`${p}.name: required`);
        validateProgression(template.progression, systemStatFields(definition, 'npc', { npcTemplateId: template.id }), `${p}.progression`, errors);
    });
    validateProgression(definition.progression.player, systemStatFields(definition, 'player'), 'progression.player', errors);
    validateCollections(definition.collections, definition.npcTemplates, errors);
    for (const col of definition.collections) if (col.levelUpRewards?.enabled) {
        const player = definition.progression.player.enabled && collectionRewardAppliesTo(col, 'player');
        const npc = definition.npcTemplates.some(t => t.progression?.enabled && collectionRewardAppliesTo(col, 'npc', t.id));
        if (!player && !npc) errors.push(`collections.${col.id}.levelUpRewards: requires a target with enabled progression`);
    }
    for (const scope of ['world', 'player', 'npc']) refs(definition.hud[`${scope}StatIds`], systemStatFields(definition, scope), `hud.${scope}StatIds`, errors);
    return errors;
}
export function finalizeDefinition(raw) {
    const errors = validateDefinition(raw);
    if (errors.length) return { definition: null, errors };
    const definition = normalizeSystemDefinition(raw);
    return { definition, errors: validateDefinition(definition) };
}
