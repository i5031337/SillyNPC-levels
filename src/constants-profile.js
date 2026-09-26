export const PROFILE_FIELDS = [
    {
        id: 'age',
        label: 'Age',
        placeholder: '34, or "late twenties"',
        hint: 'Their age. An approximation is fine when the story only implies one.',
    },
    {
        id: 'appearance',
        label: 'Appearance',
        placeholder: 'Build, hair, eyes, distinguishing marks, how they carry themselves',
        hint: 'Two or three sentences somebody could picture: build, face, hair, marks, bearing. Plain description, no metaphor.',
        multiline: true,
    },
    {
        id: 'personality',
        label: 'Personality',
        placeholder: 'What they are like day to day, and how they treat people close to them',
        /* This asked for "the flaw that gets them into trouble" - the definite article, not
           optional, and the trouble specified. Nine of eleven filled-in personalities ended
           on it, in the same shape every time: "...which leads him to...". That is not
           characterisation, it is a standing reason per character for the narrator to make
           something go wrong, injected on every message. A flaw is welcome when the story
           has shown one; being required to invent one, and to finish on it, is not. */
        hint: 'Two or three traits, shown as behaviour. What they are like to be around on an ordinary day, and how they treat the people they are close to. Mention a flaw only if the story has shown one, describe it as a limitation rather than as something that causes incidents, and do not end on it.',
        multiline: true,
    },
    {
        id: 'warmth',
        label: 'Warmth & attachment',
        placeholder: 'How they show they care - what they do, say, bring, or put up with',
        /* Relationships have a home already: the lore entry's Ties section, which asks how
           they stand with the player. This is the other half of it and does not move - Ties
           is where the relationship stands and grows, this is the habit that does not
           change. Separated on purpose, because two fields describing the same thing is the
           drift the lore prompt warns about.
           Behaviour rather than feeling, so it says something the narrator can act on. */
        hint: 'How they show they like the people close to them. Concrete behavior: what they do, say, bring, make time for, or put up with. Include how they behave toward {{user}}. If the material shows they are fond of somebody, say so plainly. Leave blank only if it shows no affection at all.',
        multiline: true,
    },
    {
        id: 'speech',
        label: 'Speech & dialogue style',
        placeholder: 'Cadence, accent, verbal tics, a turn of phrase that is theirs',
        /* "What they steer away from" resolved to emotional avoidance often enough to
           matter: eight of ten speech fields carried an avoidance clause, and where it
           landed on feeling rather than on a subject it read as a standing instruction that
           the character does not show warmth. Naming a subject is the useful half - a
           character who will not discuss the war - so that half is kept and pointed at
           subjects. Not phrased as a prohibition on writing about avoiding affection: a rule
           that names the thing tends to summon it. */
        hint: 'How they talk: cadence, accent, verbal tics, and a phrase or habit that is characteristically theirs. Describe how they sound when they are relaxed and among people they like. If they hold something back, name a topic they dodge - never write that they avoid warmth, affection, sincerity or vulnerability.',
        multiline: true,
    },
];

/** An empty profile, with every field present so nothing has to check for a missing key. */
export function blankProfile() {
    return Object.fromEntries(PROFILE_FIELDS.map(field => [field.id, '']));
}

/**
 * What Fill is told to write in one field: the user's wording if they have changed it.
 *
 * Overrides are stored per field and only where one exists, rather than as one editable
 * block of all of them. A block would be seeded once and then be the user's copy forever, so
 * a field added in a later version would never appear for anybody who had edited it - which
 * is exactly the state the extraction prompt is in, and the reason it had to be worked around
 * rather than fixed. Sparse overrides mean a new field always ships with its own hint.
 *
 * Takes the store rather than reading settings, so constants.js stays a leaf that imports
 * nothing.
 *
 * @param {{ id: string, hint: string }} field
 * @param {Record<string, string>} [overrides] settings.profileHints
 * @returns {string}
 */
export function hintFor(field, overrides) {
    const written = String(overrides?.[field?.id] ?? '').trim();
    return written || String(field?.hint ?? '');
}

/**
 * Whether Fill may write one of the profile fields on this character.
 *
 * These four are yours by default. They are the part of a character somebody sits down and
 * decides - how she talks, what she looks like - and having a model quietly overwrite that
 * is worse than leaving a blank, so the answer is no unless you have said otherwise per
 * field, per character.
 *
 * Stored as the list of fields that ARE open rather than the ones that are shut, so the
 * default falls out of an absent key and no existing character needs migrating.
 *
 * Only these four. Stats and collections come from System Builder and are the tracker's
 * job to maintain from the story; locking those would stop the feature working.
 *
 * @param {object} char
 * @param {string} fieldId
 * @returns {boolean}
 */
export function aiMayEditProfileField(char, fieldId) {
    const open = char?.aiProfileFields;
    return Array.isArray(open) && open.includes(fieldId);
}

/**
 * Whether a collection field belongs to the kind of thing rather than to one instance.
 *
 * A static field is stored once in the item library and copied onto every copy of that item:
 * every Cellphone has the same description, on whoever is carrying it. getMergedItem writes
 * these back over whatever the reader returned, so they are not merely shared - nothing the
 * per-message reader says about one has any effect.
 *
 * Numbers are the exception and default the other way, because a quantity or a charge count
 * is exactly what does differ between two people holding the same thing. A number that
 * *identifies* the item is back to being static, since that is its name.
 *
 * This rule was written out identically in four places - status-logic.js twice, the item
 * library and the shared item editor - and a fifth copy is how it would start disagreeing
 * with itself. Here because constants.js is what everything can import.
 *
 * @param {{ isStatic?: boolean, type?: string, isPrimary?: boolean }} field
 * @returns {boolean}
 */
export function isStaticField(field) {
    return field?.isStatic !== false && (field?.type !== 'number' || !!field?.isPrimary);
}

/**
 * Whether anybody has opened any profile field.
 *
 * Asked once, to decide whether the extraction schema mentions profiles at all. A schema
 * names what may come back, so listing them tells the model to go looking for changes on
 * every message - which nobody should pay for while every field is still locked, and by
 * default they all are.
 *
 * @param {object[]} characters
 * @returns {boolean}
 */
export function anyProfileFieldUnlocked(characters) {
    return (characters || []).some(char => Array.isArray(char?.aiProfileFields)
        && char.aiProfileFields.length > 0);
}
