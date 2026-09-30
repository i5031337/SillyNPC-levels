import { NPC_LORE_FIELDS, PROFILE_FIELDS } from './constants-profile.js';
import { defaultTrackerSettings } from './settings-tracker-defaults.js';
import { normalizeHudLayoutId } from './constants-base.js';

export const SYSTEM_SCHEMA_VERSION = 1;
const PROFILE_POLICIES = new Set(['anchored', 'replaceable', 'memory']);
const STAT_POLICIES = new Set(['turn', 'advancement']);
const COLLECTION_TARGETS = new Set(['player', 'npc', 'all']);
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
    const inferred = id === 'appearance' || id === 'personality' || id === 'speech'
        ? 'anchored' : 'replaceable';
    return {
        id,
        label: string(field.label, id),
        guidance: string(field.guidance, string(field.hint)),
        policy: PROFILE_POLICIES.has(field.policy) ? field.policy : inferred,
        placeholder: string(field.placeholder),
        multiline: field.multiline === true,
        retired: field.retired === true,
    };
}

function profileFields(source) {
    const used = new Set();
    return list(source).filter(value => value && typeof value === 'object')
        .map(value => profileField(value, used));
}

function statFields(source, scope) {
    const used = new Set();
    return list(source).filter(value => value && typeof value === 'object').map(value => {
        const stat = object(value);
        const id = uniqueId(stat.id || stat.name || stat.label, used);
        const name = string(stat.name, string(stat.label, id));
        const isProgression = scope === 'player' && ['level', 'level bonus'].includes(name.toLowerCase());
        return {
            id, name,
            type: stat.type === 'number' || stat.type === 'bar' ? 'number' : 'text',
            defaultValue: copy(stat.defaultValue ?? ''),
            format: string(stat.format, '{{name}}: {{value}}'),
            maxStatValue: string(stat.maxStatValue),
            visible: stat.visible !== false,
            guidance: string(stat.guidance, string(stat.hint)),
            updatePolicy: STAT_POLICIES.has(stat.updatePolicy) ? stat.updatePolicy
                : isProgression || (scope === 'npc' && stat.persistence === 'innate') ? 'advancement' : 'turn',
            advanceOnLevel: scope === 'player' && stat.advanceOnLevel === true,
            persistence: scope === 'npc' && stat.persistence === 'innate' ? 'innate' : 'turn',
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
        return {
            id,
            name: string(collection.name, id),
            target: COLLECTION_TARGETS.has(collection.target) ? collection.target : 'all',
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
                    guidance: string(field.guidance, string(field.hint)),
                    isPrimary: field.isPrimary === true,
                    isMultiline: field.isMultiline === true,
                    isStatic: field.isStatic === undefined
                        ? field.type !== 'number' || field.isPrimary === true : field.isStatic === true,
                    retired: field.retired === true,
                };
            }),
        };
    });
}

function matchingId(fields, name) {
    return fields.find(field => field.name.toLowerCase() === name)?.id || '';
}

function progression(source, playerStats, npcStats) {
    const incoming = object(source);
    const player = object(incoming.player);
    const npc = object(incoming.npc);
    const xpFieldId = string(player.xpFieldId, matchingId(playerStats, 'xp'));
    const levelFieldId = string(player.levelFieldId, matchingId(playerStats, 'level'));
    const bonusFieldId = string(player.bonusFieldId, matchingId(playerStats, 'level bonus'));
    return {
        player: {
            enabled: player.enabled === undefined ? Boolean(xpFieldId && levelFieldId) : player.enabled === true,
            xpFieldId, levelFieldId, bonusFieldId,
            bonusStatIds: Array.isArray(player.bonusStatIds)
                ? player.bonusStatIds.filter(id => playerStats.some(stat => stat.id === id))
                : playerStats.filter(stat => stat.advanceOnLevel).map(stat => stat.id),
        },
        npc: {
            enabled: npc.enabled === true,
            xpFieldId: string(npc.xpFieldId, matchingId(npcStats, 'xp')),
            levelFieldId: string(npc.levelFieldId, matchingId(npcStats, 'level')),
        },
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
    const worldStats = statFields(modern ? stats.world : tracker.globalStats ?? defaultTrackerSettings.globalStats, 'world');
    const playerStats = statFields(modern ? stats.player : tracker.playerStats ?? defaultTrackerSettings.playerStats, 'player');
    const npcStats = statFields(modern ? stats.npc : tracker.npcStats ?? defaultTrackerSettings.npcStats, 'npc');
    const hud = modern ? object(input.hud) : tracker;
    const systemName = string(name, string(input.name, string(metadata.name, 'System')));
    return {
        schemaVersion: SYSTEM_SCHEMA_VERSION,
        id: string(id, string(input.id, slug(systemName))),
        name: systemName,
        metadata: { description: string(metadata.description), author: string(metadata.author) },
        profiles: { player: playerProfile, npc: npcProfile },
        stats: { world: worldStats, player: playerStats, npc: npcStats },
        collections: collections(modern ? input.collections : tracker.collections ?? defaultTrackerSettings.collections),
        progression: progression(modern ? input.progression : {}, playerStats, npcStats),
        memories: { maxEntriesPerCharacter: memoryLimit(input.memories?.maxEntriesPerCharacter) },
        goals: {
            npcShortTerm: input.goals?.npcShortTerm !== false,
            playerShortTerm: input.goals?.playerShortTerm !== false,
            playerLongTerm: input.goals?.playerLongTerm !== false,
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
