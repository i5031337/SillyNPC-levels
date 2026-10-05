/** Canonical System schema fragments shared by generation prompts and strict validation. */
export const LIMITS = Object.freeze({ fields: 16, templates: 6, collections: 6, rewards: 12,
    requests: 48, responseChars: 60000, definitionChars: 160000, text: 4000, premise: 8000 });
export const text = { type: 'string', maxLength: LIMITS.text };
export const bool = { type: 'boolean' };
export const integer = { type: 'integer' };
export const enumeration = values => ({ type: 'string', enum: values });
export const array = (items, maxItems = LIMITS.fields) => ({ type: 'array', items, maxItems });
export const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const id = { type: 'string', pattern: '^[a-z][a-z0-9_-]*$', maxLength: 80 };
const scalar = { type: ['string', 'number', 'boolean'] };
export const progressionSchema = object({ enabled: bool, xpFieldId: text, levelFieldId: text,
    statGrowth: enumeration(['none', 'one', 'all']), statIds: array(id) });
export const profileSchema = object({ id, label: text, guidance: text,
    policy: enumeration(['anchored', 'replaceable', 'memory']), placeholder: text, multiline: bool, retired: bool },
['id', 'label', 'guidance', 'policy']);
export const statSchema = object({ id, name: text, type: enumeration(['number', 'text']), defaultValue: scalar,
    purpose: text, guidance: text, updatePolicy: enumeration(['turn', 'advancement']), format: text,
    min: text, maxStatValue: text, options: array(text), maxLength: text, locked: bool, visible: bool,
    isPrimary: bool, color: text, retired: bool, advanceOnLevel: bool, persistence: enumeration(['turn', 'innate']) },
['id', 'name', 'type', 'defaultValue', 'purpose', 'updatePolicy']);
export const fieldSchema = object({ id, name: text, label: text, type: enumeration(['text', 'number', 'boolean']),
    defaultValue: scalar, guidance: text, min: text, maxStatValue: text, options: array(text),
    isPrimary: bool, isStatic: bool, isMultiline: bool, retired: bool },
['id', 'name', 'label', 'type', 'defaultValue', 'isPrimary', 'isStatic']);
export const rewardSchema = object({ enabled: bool, mode: enumeration(['scheduled', 'guided']), guidance: text,
    interval: { type: 'integer', minimum: 1 }, schedule: array(object({ id,
        level: { type: 'integer', minimum: 2 }, entry: { type: 'object', additionalProperties: scalar } }), LIMITS.rewards) });
export const templateSchema = object({ id, name: text, description: text, profileIds: array(id), statIds: array(id),
    progression: progressionSchema }, ['id', 'name', 'description', 'profileIds', 'statIds']);
export const collectionSchema = object({ id, name: text, targets: array(text, 8), guidance: text,
    includeInImagePrompt: bool, retired: bool, fields: array(fieldSchema), levelUpRewards: rewardSchema },
['id', 'name', 'targets', 'guidance', 'fields']);
export const presentationSchema = object({ memories: object({ maxEntriesPerCharacter: { type: 'integer', minimum: 1, maximum: 500 } }),
    hud: object({ layout: enumeration(['plate', 'underline', 'pips', 'splitring']), showWorld: bool,
        showNpcPortraits: bool, playerStatIds: array(id), npcStatIds: array(id), worldStatIds: array(id) }) });
export const definitionSchema = object({ schemaVersion: { type: 'integer', enum: [1] }, id, name: text,
    metadata: object({ description: text, author: text }), profiles: object({ player: array(profileSchema), npc: array(profileSchema) }),
    stats: object({ world: array(statSchema), player: array(statSchema), npc: array(statSchema) }),
    npcTemplates: array(templateSchema, LIMITS.templates), collections: array(collectionSchema, LIMITS.collections),
    progression: object({ player: progressionSchema, npc: progressionSchema }), ...presentationSchema.properties });

const plannedField = object({ name: text, purpose: text });
const plannedProgression = object({ enabled: bool,
    xp: { ...text, description: 'Exact XP stat NAME in this owner catalog, never a numeric default. Empty only when disabled.' },
    level: { ...text, description: 'Exact Level stat NAME in this owner catalog, never a starting value. Empty only when disabled.' },
    growth: text });
export const planSchema = object({ name: text, description: text, rationale: text,
    profiles: object({ player: array(plannedField), npc: array(plannedField) }),
    stats: object({ world: array(plannedField), player: array(plannedField), npc: array(plannedField) }),
    playerProgression: plannedProgression,
    npcTemplates: array(object({ name: text, description: text,
        profiles: { ...array(text), description: 'Exact attribute names from profiles.npc, not actor categories.' },
        stats: { ...array(text), description: 'Exact stat names from stats.npc only, including XP/Level if progression is enabled.' },
        progression: plannedProgression }), LIMITS.templates),
    collections: array(object({ name: text, purpose: text, targets: array(text, 8), fields: array(plannedField),
        rewards: enumeration(['none', 'scheduled', 'guided']) }), LIMITS.collections) });
export const responseSchema = section => object({ section, assumptions: array(text, 12) });
