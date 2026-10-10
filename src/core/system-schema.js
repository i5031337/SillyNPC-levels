import { statBehavior } from '../tracker/stat-update-policy.js';
import { normalizeProgressionConfig } from './progression-config.js';
import { normalizeCollectionRewards } from './collection-rewards.js';
import { ensureCollectionIdentifier, ensureCollectionQuantity } from './collection-fields.js';
import { collectionTargets } from './collection-targets.js';
import { fieldTargets, systemStatFields, systemProfileFields, templateStatIds } from './system-fields.js';
import { NPC_LORE_FIELDS, PROFILE_FIELDS } from './constants-profile.js';
import { defaultTrackerSettings } from './settings-tracker-defaults.js';
import { normalizeHudLayoutId } from './constants-base.js';

export const SYSTEM_SCHEMA_VERSION = 2;

const IDENTIFIER = /^[a-z][a-z0-9_-]*$/;

const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value : [];
const string = (value, fallback = '') => typeof value === 'string' ? value : fallback;
const copy = value => structuredClone(value);
const memoryLimit = value => Number.isSafeInteger(value) && value >= 1 && value <= 500 ? value : 50;
const slug = value => String(value || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field';

function uniqueId(candidate, used) {
    let base = string(candidate).trim();
    if (!IDENTIFIER.test(base)) base = slug(base);
    if (!/^[a-z]/.test(base)) base = `f-${base}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
}

function profileField(source, used) {
    const field = object(source);
    const id = uniqueId(field.id || field.label, used);
    return {
        id,
        label: string(field.label, id),
        guidance: string(field.guidance, string(field.hint)),
        placeholder: string(field.placeholder),
        multiline: field.multiline === true,
        includeInImagePrompt: typeof field.includeInImagePrompt === 'boolean'
            ? field.includeInImagePrompt : ['age', 'appearance'].includes(id),
        retired: field.retired === true,
        ...(field.legacyId ? { legacyId: string(field.legacyId) } : {}),
    };
}

function profileFields(source) {
    const used = new Set();
    return list(source).filter(value => value && typeof value === 'object')
        .map(value => profileField(value, used));
}

function statFields(source, scope, xpIds = []) {
    const used = new Set();
    return list(source).filter(value => value && typeof value === 'object').map(value => {
        const stat = object(value);
        const id = uniqueId(stat.id || stat.name || stat.label, used);
        const name = string(stat.name, string(stat.label, id));
        return {
            id, name,
            type: stat.type === 'number' || stat.type === 'bar' ? 'number' : 'text',
            defaultValue: copy(stat.defaultValue ?? ''),
            format: typeof stat.format === 'string' && !stat.format.includes('{{name}}')
                ? '{{value}}' : '{{name}}: {{value}}',
            maxStatValue: string(stat.maxStatValue),
            min: String(stat.min ?? ''),
            options: stat.type === 'number' || stat.type === 'bar' ? []
                : list(stat.options).map(value => String(value).trim()).filter(Boolean),
            maxLength: String(stat.maxLength ?? ''),
            ...statBehavior(stat, scope, xpIds.includes(stat.id) ? stat.id : undefined),
            ...(scope !== 'world' ? { carryOver: stat.carryOver === true || statBehavior(stat, scope).carryOver === true } : {}),
            visible: stat.visible !== false,
            guidance: string(stat.guidance, string(stat.hint)),
            purpose: string(stat.purpose),
            advanceOnLevel: stat.advanceOnLevel === true,
            isPrimary: stat.isPrimary === true,
            color: string(stat.color),
            retired: stat.retired === true,
        };
    });
}

function collections(source) {
    const used = new Set();
    return list(source).filter(value => value && typeof value === 'object').map(value => {
        const collection = object(value);
        const id = uniqueId(collection.id || collection.name, used);
        const fieldIds = new Set();
        const normalized = {
            id,
            name: string(collection.name, id),
            targets: collectionTargets(collection),
            trackQuantity: collection.trackQuantity,
            includeInImagePrompt: collection.includeInImagePrompt !== false,
            guidance: string(collection.guidance),
            retired: collection.retired === true,
            fields: list(collection.fields).filter(value => value && typeof value === 'object').map(value => {
                const field = object(value);
                const fieldId = uniqueId(field.id || field.name || field.label, fieldIds);
                return {
                    id: fieldId,
                    name: string(field.name, fieldId),
                    label: string(field.label, string(field.name, fieldId)),
                    type: ['number', 'boolean'].includes(field.type) ? field.type : 'text',
                    defaultValue: copy(field.defaultValue ?? ''),
                    ...(field.type === 'number' ? { min: String(field.min ?? ''), maxStatValue: String(field.maxStatValue ?? '') }
                        : Array.isArray(field.options) ? { options: field.options.map(value => String(value).trim()).filter(Boolean) } : {}),
                    guidance: string(field.guidance, string(field.hint)),
                    isPrimary: field.isPrimary === true,
                    isMultiline: field.isMultiline === true,
                    isStatic: field.isStatic === undefined
                        ? field.type !== 'number' || field.isPrimary === true : field.isStatic === true,
                    retired: field.retired === true,
                };
            }),
        };
        ensureCollectionIdentifier(normalized);
        ensureCollectionQuantity(normalized);
        normalized.levelUpRewards = normalizeCollectionRewards(collection.levelUpRewards, normalized);
        return normalized;
    });
}

/** Merge equal definitions while retaining independent legacy definitions and references. */
function mergeCatalogs(player, npc, profile = false) {
    const used = new Set();
    const fields = [];
    const playerIds = new Map(), npcIds = new Map();
    const equivalent = (a, b) => {
        const omit = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['id', 'targets', 'carryOver', 'advanceOnLevel'].includes(key)));
        return JSON.stringify(omit(a)) === JSON.stringify(omit(b));
    };
    for (const [scope, source, ids] of [['player', player, playerIds], ['npc', npc, npcIds]]) {
        for (const field of source) {
            let existing = fields.find(item => item.id === field.id && equivalent(item, field));
            if (existing) {
                existing.targets = [...new Set([...existing.targets, ...(scope === 'player' ? ['player'] : field.targets)])];
                if (!profile) { existing.carryOver = field.carryOver === true; existing.advanceOnLevel ||= field.advanceOnLevel; }
            } else {
                const id = uniqueId(field.id, used);
                existing = { ...field, id, targets: scope === 'player' ? ['player'] : field.targets };
                if (profile && id !== field.id) existing.legacyId = field.id;
                fields.push(existing);
            }
            ids.set(field.id, existing.id);
        }
    }
    return { fields, playerIds, npcIds };
}

/** Pure, bounded conversion of a legacy preset or a modern definition. World data is ignored. */
export function normalizeSystemDefinition(source, { id, name } = {}) {
    const input = object(source);
    const modern = input.schemaVersion === 1 || input.schemaVersion === SYSTEM_SCHEMA_VERSION;
    const shared = input.schemaVersion === SYSTEM_SCHEMA_VERSION;
    const config = modern ? input : object(input.config || input);
    const tracker = modern ? input : object(config.statusTracker || config);
    const profiles = object(input.profiles);
    const stats = object(input.stats);
    const metadata = object(input.metadata);
    const hints = object(config.profileHints);
    const legacyProfile = fields => fields.map(field => ({
        ...field, guidance: string(hints[field.id], field.hint),
    }));
    const playerProfile = profileFields(modern ? profiles.player : legacyProfile(PROFILE_FIELDS));
    const npcProfile = profileFields(modern ? profiles.npc : legacyProfile(NPC_LORE_FIELDS));
    const npcStats = statFields(modern ? stats.npc : tracker.npcStats ?? defaultTrackerSettings.npcStats, 'npc', list(input.npcTemplates).map(template => template?.progression?.xpFieldId));
    const playerStats = statFields(modern ? stats.player : tracker.playerStats ?? defaultTrackerSettings.playerStats, 'player', [input.progression?.player?.xpFieldId ?? tracker.progression?.player?.xpFieldId]);
    const templateIds = new Set();
    const oldTemplates = Array.isArray(input.npcTemplates) ? input.npcTemplates : [{ id: 'npc', name: 'NPC',
        description: 'NPCs using this System’s original character fields.', profileIds: npcProfile.map(field => field.id), statIds: npcStats.map(field => field.id) }];
    const templates = oldTemplates.map(value => {
        const template = object(value);
        return { id: uniqueId(template.id || template.name, templateIds), name: string(template.name, 'NPC'),
            description: string(template.description), progression: template.progression };
    });
    const assignments = (fields, key) => fields.map(field => ({ ...field, targets: templates
        .filter((template, index) => list(oldTemplates[index]?.[key]).includes(field.id))
        .map(template => `template:${template.id}`) }));
    const statCatalog = shared ? { fields: statFields(stats.character, 'npc').map((field, index) => ({ ...field, targets: fieldTargets(list(stats.character)[index]) })), playerIds: new Map(), npcIds: new Map() }
        : mergeCatalogs(playerStats, assignments(npcStats, 'statIds'));
    const profileCatalog = shared ? { fields: profileFields(input.profiles).map((field, index) => ({ ...field, targets: fieldTargets(list(input.profiles)[index]) })) }
        : mergeCatalogs(playerProfile, assignments(npcProfile, 'profileIds'), true);
    const character = statCatalog.fields;
    const remap = (config, ids) => ({ ...object(config),
        ...(config?.xpFieldId ? { xpFieldId: ids.get(config.xpFieldId) || config.xpFieldId } : {}),
        ...(config?.levelFieldId ? { levelFieldId: ids.get(config.levelFieldId) || config.levelFieldId } : {}),
        ...(Array.isArray(config?.statIds) ? { statIds: config.statIds.map(id => ids.get(id) || id) } : {}) });
    const catalogSystem = { stats: { character }, npcTemplates: templates };
    const livePlayer = systemStatFields(catalogSystem, 'player');
    const liveNpc = systemStatFields(catalogSystem, 'npc');
    templates.forEach(template => { template.progression = normalizeProgressionConfig(remap(template.progression, statCatalog.npcIds || new Map()), character,
        { statIds: templateStatIds(catalogSystem, template) }); });
    const worldStats = statFields(modern ? stats.world : tracker.globalStats ?? defaultTrackerSettings.globalStats, 'world');
    const hud = modern ? object(input.hud) : tracker;
    const playerProgression = normalizeProgressionConfig(remap((modern ? input.progression : tracker.progression)?.player, statCatalog.playerIds), livePlayer, { enabledByDefault: true });
    for (const field of [...character, ...worldStats]) delete field.advanceOnLevel;
    const systemName = string(name, string(input.name, string(metadata.name, 'System')));
    return {
        schemaVersion: SYSTEM_SCHEMA_VERSION,
        id: string(id, string(input.id, slug(systemName))),
        name: systemName,
        metadata: { description: string(metadata.description), author: string(metadata.author) },
        profiles: profileCatalog.fields,
        npcTemplates: templates,
        ...(!Array.isArray(input.npcTemplates) || templates.some(template => template.id === input.legacyNpcTemplateId)
            ? { legacyNpcTemplateId: input.legacyNpcTemplateId || 'npc' } : {}),
        stats: { world: worldStats, character },
        collections: collections(modern ? input.collections : tracker.collections ?? defaultTrackerSettings.collections),
        progression: { player: playerProgression },
        memories: {
            enabled: input.memories?.enabled === true,
            guidance: string(input.memories?.guidance).slice(0, 4000),
            interval: Number.isSafeInteger(input.memories?.interval) && input.memories.interval >= 1 && input.memories.interval <= 100
                ? input.memories.interval : 8,
            maxEntriesPerCharacter: memoryLimit(input.memories?.maxEntriesPerCharacter),
        },
        hud: {
            layout: normalizeHudLayoutId(string(hud.layout, string(hud.hudLayout, 'plate'))),
            showWorld: hud.showWorld === undefined ? hud.showGlobalStats !== false : hud.showWorld === true,
            showNpcPortraits: hud.showNpcPortraits !== false,
            playerStatIds: Array.isArray(hud.playerStatIds) ? hud.playerStatIds.map(id => statCatalog.playerIds.get(id) || id).filter(value => livePlayer.some(stat => stat.id === value))
                : livePlayer.filter(stat => stat.visible).map(stat => stat.id),
            npcStatIds: Array.isArray(hud.npcStatIds) ? hud.npcStatIds.map(id => statCatalog.npcIds.get(id) || id).filter(value => liveNpc.some(stat => stat.id === value))
                : liveNpc.filter(stat => stat.visible).map(stat => stat.id),
            worldStatIds: Array.isArray(hud.worldStatIds) ? hud.worldStatIds.filter(value => worldStats.some(stat => stat.id === value))
                : worldStats.filter(stat => stat.visible).map(stat => stat.id),
        },
    };
}

/** Resolve a field by immutable ID; labels are presentation only. */
export function getSystemField(system, scope, kind, fieldId) {
    const fields = kind === 'profile' ? systemProfileFields(system, scope) : systemStatFields(system, scope);
    return list(fields).find(field => field.id === fieldId) || null;
}

/** Runtime projections retain actor-specific consumers without duplicating saved catalogs. */
export function projectSystemTracker(system) {
    const stat = fields => fields.map(field => ({ ...field, hint: field.guidance }));
    return { globalStats: stat(systemStatFields(system, 'world')), playerStats: stat(systemStatFields(system, 'player')),
        npcStats: stat(systemStatFields(system, 'npc')), collections: system.collections.map(collection => ({ ...collection,
            hint: collection.guidance, fields: collection.fields.map(field => ({ ...field, hint: field.guidance })) })),
        progression: structuredClone(system.progression), npcTemplates: structuredClone(system.npcTemplates),
        hudLayout: system.hud.layout, showGlobalStats: system.hud.showWorld, showNpcPortraits: system.hud.showNpcPortraits };
}
