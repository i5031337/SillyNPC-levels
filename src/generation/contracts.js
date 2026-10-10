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
    pointsPerLevel: { type: 'integer', minimum: 0 }, assignment: enumeration(['random', 'manual']), statIds: array(id) });
export const profileSchema = object({ id, label: text, guidance: text, targets: array(text, 8),
    placeholder: text, multiline: { ...bool, description: 'Display as a text section when true, or a compact badge when false. All profile value editors support multiple lines.' }, includeInImagePrompt: bool, retired: bool, legacyId: text },
['id', 'label', 'guidance', 'targets']);
export const statSchema = object({ id, name: text, type: enumeration(['number', 'text']), defaultValue: { ...scalar, description: 'Numeric pools use a current/maximum string such as 10/10. This is a starting default; each NPC may initialize its own capacity. Plain numbers define ratings.' },
    purpose: text, guidance: text, format: enumeration(['{{name}}: {{value}}', '{{value}}']),
    min: text, maxStatValue: text, options: array(text), maxLength: text, locked: bool, visible: bool,
    isPrimary: bool, color: text, retired: bool, carryOver: bool },
['id', 'name', 'type', 'defaultValue', 'purpose', 'locked']);
export const fieldSchema = object({ id, name: text, label: text, type: enumeration(['text', 'number', 'boolean']),
    defaultValue: scalar, guidance: text, min: text, maxStatValue: text, options: array(text),
    isPrimary: bool, isStatic: { ...bool, description: 'Always true for the identifier (isPrimary); other numeric fields must be false. Other fields may be shared static or personal.' }, isMultiline: bool, retired: bool },
['id', 'name', 'label', 'type', 'defaultValue', 'isPrimary', 'isStatic']);
export const rewardSchema = object({ enabled: bool, mode: enumeration(['scheduled', 'guided']), guidance: text,
    interval: { type: 'integer', minimum: 1 }, schedule: array(object({ id,
        level: { type: 'integer', minimum: 2 }, entry: { type: 'object', additionalProperties: scalar } }), LIMITS.rewards) });
export const characterStatSchema = object({ ...statSchema.properties, targets: array(text, 8) }, [...statSchema.required, 'targets']);
export const templateSchema = object({ id, name: text, description: text, progression: progressionSchema });
export const collectionSchema = object({ id, name: text, targets: array(text, 8), guidance: text,
    trackQuantity: bool, includeInImagePrompt: bool, retired: bool, fields: array(fieldSchema), levelUpRewards: rewardSchema },
['id', 'name', 'targets', 'guidance', 'trackQuantity', 'fields']);
export const memorySchema = object({ enabled: bool, guidance: text,
    interval: { type: 'integer', minimum: 1, maximum: 100 },
    maxEntriesPerCharacter: { type: 'integer', minimum: 1, maximum: 500 } });
export const presentationSchema = object({ memories: memorySchema,
    hud: object({ layout: enumeration(['plate', 'underline', 'pips', 'splitring']), showWorld: bool,
        showNpcPortraits: bool, playerStatIds: array(id), npcStatIds: array(id), worldStatIds: array(id) }) });
export const definitionSchema = object({ schemaVersion: { type: 'integer', enum: [2] }, id, name: text,
    metadata: object({ description: text, author: text }), profiles: array(profileSchema),
    stats: object({ world: array(statSchema), character: array(characterStatSchema) }),
    npcTemplates: array(templateSchema, LIMITS.templates), legacyNpcTemplateId: text, collections: array(collectionSchema, LIMITS.collections),
    progression: object({ player: progressionSchema }), ...presentationSchema.properties },
['schemaVersion', 'id', 'name', 'metadata', 'profiles', 'stats', 'npcTemplates', 'collections', 'progression', ...Object.keys(presentationSchema.properties)]);

const plannedField = object({ name: text, purpose: text });
const plannedCharacterField = object({ ...plannedField.properties, targets: array(text, 8) });
const plannedProgression = object({ enabled: bool,
    xp: { ...text, description: 'Exact XP stat NAME in the character catalog assigned to this owner, never a numeric default. Empty only when disabled.' },
    level: { ...text, description: 'Exact Level stat NAME in the character catalog assigned to this owner, never a starting value. Empty only when disabled.' },
    growth: text });
export const planSchema = object({ name: text, description: text, rationale: text, memories: memorySchema,
    profiles: array(plannedCharacterField),
    stats: object({ world: array(plannedField), character: array(plannedCharacterField) }),
    playerProgression: plannedProgression,
    npcTemplates: array(object({ name: text, description: text, progression: plannedProgression }), LIMITS.templates),
    collections: array(object({ name: text, purpose: text, targets: array(text, 8), trackQuantity: bool, fields: array(plannedField),
        rewards: enumeration(['none', 'scheduled', 'guided']) }), LIMITS.collections) });
export const responseSchema = section => object({ section, assumptions: array(text, 12) });
