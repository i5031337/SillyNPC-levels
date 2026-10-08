import { statBehavior } from '../tracker/stat-update-policy.js';
import { normalizeProgressionConfig } from './progression-config.js';
import { normalizeCollectionRewards } from './collection-rewards.js';
import { ensureCollectionIdentifier } from './collection-fields.js';
import { collectionTargets } from './collection-targets.js';
import { NPC_LORE_FIELDS, PROFILE_FIELDS } from './constants-profile.js';
import { defaultTrackerSettings } from './settings-tracker-defaults.js';
import { normalizeHudLayoutId } from './constants-base.js';

export const SYSTEM_SCHEMA_VERSION = 1;

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
            format: string(stat.format, '{{name}}: {{value}}'),
            maxStatValue: string(stat.maxStatValue),
            min: String(stat.min ?? ''),
            options: stat.type === 'number' || stat.type === 'bar' ? []
                : list(stat.options).map(value => String(value).trim()).filter(Boolean),
            maxLength: String(stat.maxLength ?? ''),
            ...statBehavior(stat, scope, xpIds.includes(stat.id) ? stat.id : undefined),
            visible: stat.visible !== false,
            guidance: string(stat.guidance, string(stat.hint)),
            purpose: string(stat.purpose),
            advanceOnLevel: scope === 'player' && stat.advanceOnLevel === true,
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
        normalized.levelUpRewards = normalizeCollectionRewards(collection.levelUpRewards, normalized);
        return normalized;
    });
}

function progression(source, playerStats, npcStats) {
    const incoming = object(source);
    return {
        player: normalizeProgressionConfig(incoming.player, playerStats, { enabledByDefault: true }),
        npc: normalizeProgressionConfig(incoming.npc, npcStats),
    };
}

/** Pure, bounded conversion of a legacy preset or a modern definition. World data is ignored. */
export function normalizeSystemDefinition(source, { id, name } = {}) {
    const input = object(source);
    const modern = input.schemaVersion === SYSTEM_SCHEMA_VERSION;
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
    const templateIds = new Set();
    const templates = Array.isArray(input.npcTemplates) ? input.npcTemplates.map(value => {
        const template = object(value);
        return {
            id: uniqueId(template.id || template.name, templateIds),
            name: string(template.name, 'NPC'), description: string(template.description),
            profileIds: [...new Set(list(template.profileIds).filter(id => npcProfile.some(field => field.id === id)))],
            statIds: [...new Set(list(template.statIds).filter(id => npcStats.some(field => field.id === id)))],
            progression: normalizeProgressionConfig(template.progression, npcStats, { statIds: list(template.statIds) }),
        };
    }) : [{ id: 'npc', name: 'NPC', description: 'NPCs using this System’s original character fields.',
        profileIds: npcProfile.filter(field => !field.retired).map(field => field.id),
        statIds: npcStats.map(field => field.id), progression: normalizeProgressionConfig({}, npcStats) }];
    const worldStats = statFields(modern ? stats.world : tracker.globalStats ?? defaultTrackerSettings.globalStats, 'world');
    const playerStats = statFields(modern ? stats.player : tracker.playerStats ?? defaultTrackerSettings.playerStats, 'player', [input.progression?.player?.xpFieldId ?? tracker.progression?.player?.xpFieldId]);
    const hud = modern ? object(input.hud) : tracker;
    const systemName = string(name, string(input.name, string(metadata.name, 'System')));
    return {
        schemaVersion: SYSTEM_SCHEMA_VERSION,
        id: string(id, string(input.id, slug(systemName))),
        name: systemName,
        metadata: { description: string(metadata.description), author: string(metadata.author) },
        profiles: { player: playerProfile, npc: npcProfile },
        npcTemplates: templates,
        ...(!Array.isArray(input.npcTemplates) || templates.some(template => template.id === input.legacyNpcTemplateId)
            ? { legacyNpcTemplateId: input.legacyNpcTemplateId || 'npc' } : {}),
        stats: { world: worldStats, player: playerStats, npc: npcStats },
        collections: collections(modern ? input.collections : tracker.collections ?? defaultTrackerSettings.collections),
        progression: progression(modern ? input.progression : tracker.progression, playerStats, npcStats),
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
            playerStatIds: Array.isArray(hud.playerStatIds) ? hud.playerStatIds.filter(value => playerStats.some(stat => stat.id === value))
                : playerStats.filter(stat => stat.visible).map(stat => stat.id),
            npcStatIds: Array.isArray(hud.npcStatIds) ? hud.npcStatIds.filter(value => npcStats.some(stat => stat.id === value))
                : npcStats.filter(stat => stat.visible).map(stat => stat.id),
            worldStatIds: Array.isArray(hud.worldStatIds) ? hud.worldStatIds.filter(value => worldStats.some(stat => stat.id === value))
                : worldStats.filter(stat => stat.visible).map(stat => stat.id),
        },
    };
}

/** Resolve a field by immutable ID; labels are presentation only. */
export function getSystemField(system, scope, kind, fieldId) {
    const fields = kind === 'profile' ? system?.profiles?.[scope] : system?.stats?.[scope];
    return list(fields).find(field => field.id === fieldId) || null;
}
