const CHARACTER_FIELD_DEFS = [
    {
        id: 'age',
        label: 'Age',
        player: true,
        placeholder: 'Age or age range',
        hint: 'Age or approximate age.',
    },
    {
        id: 'appearance',
        label: 'Appearance',
        player: true,
        placeholder: 'Build, face, hair, distinguishing features',
        hint: 'Physical details that make them recognizable.',
        multiline: true,
    },
    {
        id: 'personality',
        label: 'Personality',
        player: true,
        placeholder: 'Defining traits and behavior',
        hint: 'Defining traits and how they behave with others.',
        multiline: true,
    },
    {
        id: 'speech',
        label: 'Speech & dialogue style',
        player: true,
        placeholder: 'Accent, cadence, word choice, verbal habits',
        hint: 'What makes their voice distinctive.',
        multiline: true,
    },
    { id: 'role', label: 'Role', hint: 'Who they are and what they do.', placeholder: 'Occupation or place in the world', multiline: true },
    { id: 'wants', label: 'Wants', hint: 'Their current goal or concern.', placeholder: 'A goal or concern', multiline: true },
    { id: 'ties', label: 'Ties', hint: 'People who matter to them and why.', placeholder: 'Key relationships', multiline: true },
    { id: 'history', label: 'History', hint: 'Past events that shape them now.', placeholder: 'Relevant history', multiline: true },
];

export const PROFILE_FIELDS = CHARACTER_FIELD_DEFS.filter(field => field.player);
export const NPC_LORE_FIELDS = CHARACTER_FIELD_DEFS.filter(field => field.npc !== false);

export function fieldsForCard(card) {
    return card?.isPlayer ? PROFILE_FIELDS : NPC_LORE_FIELDS;
}

export function blankProfile(isPlayer = false) {
    return Object.fromEntries((isPlayer ? PROFILE_FIELDS : NPC_LORE_FIELDS).map(field => [field.id, '']));
}

export function hintFor(field) {
    return String(field?.hint ?? '');
}

export function aiMayEditProfileField(char, fieldId) {
    const open = char?.aiProfileFields;
    return Array.isArray(open) && open.includes(fieldId);
}

export function isStaticField(field) {
    return field?.isStatic !== false && (field?.type !== 'number' || !!field?.isPrimary);
}

export function anyProfileFieldUnlocked(characters) {
    return (characters || []).some(char => Array.isArray(char?.aiProfileFields)
        && char.aiProfileFields.length > 0);
}
