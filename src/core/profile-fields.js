import { setNpcTemplateSettingsProvider, npcProfileIdsFor } from './npc-templates.js';
import { NPC_LORE_FIELDS, PROFILE_FIELDS } from './constants-profile.js';

let settingsProvider = () => null;

/** Installed by settings.js; keeping this module pure lets lore formatting run in Node. */
export function setProfileSettingsProvider(provider) {
    settingsProvider = provider;
    setNpcTemplateSettingsProvider(provider);
}

/** The active System is the authority for fields shown and requested at runtime. */
export function resolveProfileFieldsFromSystem(system, scope) {
    const fields = system?.profiles?.[scope];
    if (!Array.isArray(fields)) return null;
    return fields.filter(field => field && !field.retired && field.id).map(field => ({
        id: field.id,
        label: field.label || field.id,
        hint: field.guidance ?? field.hint ?? '',
        placeholder: field.placeholder || '',
        multiline: field.multiline === true,
        includeInImagePrompt: typeof field.includeInImagePrompt === 'boolean'
            ? field.includeInImagePrompt : ['age', 'appearance'].includes(field.id),
        policy: field.policy || (['appearance', 'personality', 'speech'].includes(field.id) ? 'anchored' : 'replaceable'),
    }));
}

export function resolveProfileFields(scope, settings = settingsProvider()) {
    const active = settings?.activeSystem;
    const system = active && settings?.statusTracker?.presets?.[active]?.definition;
    return resolveProfileFieldsFromSystem(system, scope)
        ?? (scope === 'player' ? PROFILE_FIELDS : NPC_LORE_FIELDS).map(field => ({
            ...field, policy: ['appearance', 'personality', 'speech'].includes(field.id)
                ? 'anchored' : 'replaceable',
        }));
}

export function profileFieldsForCard(card, settings) {
    const fields = resolveProfileFields(card?.isPlayer ? 'player' : 'npc', settings);
    if (card?.isPlayer) return fields;
    const ids = npcProfileIdsFor(card, settings === undefined ? undefined
        : settings?.statusTracker?.presets?.[settings.activeSystem]?.definition);
    return ids ? fields.filter(field => ids.has(field.id)) : fields;
}

export function blankActiveProfile(isPlayer = false, settings) {
    return Object.fromEntries(resolveProfileFields(isPlayer ? 'player' : 'npc', settings)
        .map(field => [field.id, '']));
}

/** Preserve even retired or unknown prose when a card crosses a System boundary. */
export function profileStrings(profile) {
    return Object.fromEntries(Object.entries(profile || {})
        .filter(([, value]) => typeof value === 'string' && value.trim())
        .map(([id, value]) => [id, value.trim()]));
}
