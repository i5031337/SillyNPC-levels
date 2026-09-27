import { getAllCharacters } from '../../characters/character-repository.js';
import { PROFILE_FIELDS, NPC_LORE_FIELDS, anyProfileFieldUnlocked } from '../../core/constants.js';
import { getPlayerCard } from '../status-logic.js';
import { poolTags, strangerKind } from '../../characters/default-portraits.js';

/**
 * Everyone who has a profile that could be unlocked: the cards, and the player.
 *
 * The player's four fields live on their persona record rather than in the character list,
 * so asking the list alone would miss a player who has opened one. Guarded because
 * getPlayerCard needs a persona, and the schema is built in places where there may not be
 * one yet.
 */
export function profileOwners() {
    const cards = getAllCharacters();
    try {
        return [...cards, getPlayerCard()];
    } catch {
        return cards;
    }
}

/**
 * A JSON schema describing exactly the stats and collections this user has configured.
 *
 * Deliberately restricted to the keywords Google's structured-output subset accepts:
 * type, properties, items, required. An earlier version used additionalProperties,
 * which Gemini does not support - the schema was rejected and every reply came back as
 * an empty object. The system prompt carries the "no other keys" rule instead.
 *
 * @param {object} trackerSettings
 */
export function buildExtractionSchema(trackerSettings, { strangers = [] } = {}) {
    // Takes the stat definitions rather than their names, so a field that says how it
    // should be written can pass that on. A free-text field used to arrive as nothing but
    // a name and `{ type: 'string' }`, which is how one grew into a running log.
    const stringMap = (stats) => ({
        type: 'object',
        properties: Object.fromEntries((stats || [])
            .filter(stat => stat?.name)
            .map(stat => [
                stat.name,
                stat.hint?.trim()
                    ? { type: 'string', description: stat.hint.trim() }
                    : { type: 'string' },
            ])),
    });

    // A collection is a delta, not a listing. Asking for the full contents meant any
    // item the model failed to restate read as a deletion, which is how characters
    // kept being proposed for losing things the story never took from them.
    const collectionProps = (target) => {
        const relevant = (trackerSettings.collections || [])
            .filter(c => c.target === 'all' || c.target === target);
        if (!relevant.length) return null;
        const itemShape = (col) => ({
            type: 'object',
            properties: Object.fromEntries((col.fields || []).map(f => [
                f.name,
                { type: f.type === 'number' ? 'number' : (f.type === 'boolean' ? 'boolean' : 'string') },
            ])),
        });
        return {
            type: 'object',
            properties: Object.fromEntries(relevant.map(col => [col.id, {
                type: 'object',
                properties: {
                    add: { type: 'array', items: itemShape(col) },
                    remove: { type: 'array', items: { type: 'string' } },
                    /* The third verb, which the reader could not reach.
                       A schema names what may come back, so leaving "update" out told the
                       model not to send one - while the inline prompt documented all three
                       and applyCollectionUpdate handled all three. A half-drunk potion had
                       no way to be reported, so it arrived as an "add" that merged field by
                       field, or not at all. */
                    update: { type: 'array', items: itemShape(col) },
                },
            }])),
        };
    };

    const globalStatDefs = trackerSettings.globalStats || [];
    const playerStatDefs = trackerSettings.playerStats || [];
    const npcStatDefs = trackerSettings.npcStats || [];

    const playerCollections = collectionProps('player');
    const npcCollections = collectionProps('npc');

    /* Named profile and NPC lore fields, but only if somebody has unlocked one.
     *
     * A schema names what may come back, so listing these tells the model to look for
     * changes to them on every message - work and tokens nobody should pay for a feature
     * they have not switched on. The lock is per character and per field, so "any of them,
     * anywhere" is the only question the schema can ask; the apply side does the precise
     * filtering and drops anything for a field that is still locked. */
    const owners = profileOwners();
    const profileShape = (fields) => ({
        type: 'object',
        properties: Object.fromEntries(fields.map(field => [
            field.id, { type: 'string', description: field.hint },
        ])),
    });
    const playerProfileProps = anyProfileFieldUnlocked(owners.filter(card => card.isPlayer))
        ? profileShape(PROFILE_FIELDS) : null;
    const npcProfileProps = anyProfileFieldUnlocked(owners.filter(card => !card.isPlayer))
        ? profileShape(NPC_LORE_FIELDS) : null;

    return {
        type: 'object',
        // Required at the top level so a model cannot satisfy the schema with "{}",
        // which is exactly what happened while the schema was being rejected.
        required: ['global', 'player', 'characters'],
        properties: {
            global: stringMap(globalStatDefs),
            player: {
                type: 'object',
                properties: {
                    stats: stringMap(playerStatDefs),
                    ...(playerCollections ? { collections: playerCollections } : {}),
                    ...(playerProfileProps ? { profile: playerProfileProps } : {}),
                },
            },
            characters: {
                type: 'array',
                items: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                        name: { type: 'string' },
                        stats: stringMap(npcStatDefs),
                        ...(npcCollections ? { collections: npcCollections } : {}),
                        ...(npcProfileProps ? { profile: npcProfileProps } : {}),
                    },
                },
            },
            /* Only when reasons are on, and for the reason threads are below: a schema names
               what may come back, so a key it leaves out is a key the model is told not to
               send. The ask would still be in the prompt and the answer would never arrive. */
            ...(trackerSettings.extractionReasons === false ? {} : {
                why: { type: 'object', additionalProperties: { type: 'string' } },
            }),
            // Only when threads are on. A schema names what may come back, so a key it
            // does not mention is a key the model is told not to send - the ask would
            // still be in the prompt and the answer would never arrive, which is the
            // worst shape of failure: a feature that is switched on and silent.
            ...(trackerSettings.threadsEnabled === true ? {
                threads: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['text', 'quote'],
                        properties: {
                            kind: { type: 'string' },
                            text: { type: 'string' },
                            quote: { type: 'string' },
                            who: { type: 'string' },
                        },
                    },
                },
                closed: { type: 'array', items: { type: 'string' } },
            } : {}),
            // Only when there are strangers to ask about - see strangerValues.
            ...(strangers.length ? {
                strangers: {
                    type: 'object',
                    properties: Object.fromEntries(strangers.map(name => [name, { type: 'string' }])),
                },
            } : {}),
        },
    };
}

/**
 * The speakers in a message who have no card and no kind yet - the ones to ask about.
 *
 * Read off the rendered message, where the chat has already marked every speaker it could
 * not match to a card. The persona is never a stranger.
 *
 * @returns {string[]}
 */
export function strangersToClassify(messageId) {
    if (poolTags().length === 0 || typeof document === 'undefined') return [];
    const mesEl = document.querySelector(`#chat .mes[mesid="${Number(messageId)}"]`);
    if (!mesEl) return [];
    const names = new Map();
    for (const avatar of mesEl.querySelectorAll('.sillynpc-chat-avatar[data-default="true"]')) {
        if (avatar.dataset.persona === 'true') continue;
        const name = String(avatar.dataset.charName ?? '').trim();
        if (name && strangerKind(name) === undefined) names.set(name.toLowerCase(), name);
    }
    return [...names.values()];
}

/**
 * Asks the reader what kind of stranger each cardless speaker is, from the picture tags only.
 *
 * The tags are categories for fallback portraits. Which one a shopkeeper or a wolf belongs
 * to cannot be read off their name, and nobody can tag for every description - but the
 * reader is reading the reply anyway, and choosing from a short closed list is a small ask.
 *
 * @returns {{ strangers: string, strangerKinds: string, strangerExample: string }} All empty
 *   when there is nobody to ask about, which leaves the STRANGERS section out.
 */
export function strangerValues(strangers, tags = poolTags()) {
    if (!strangers?.length || !tags.length) return { strangers: '', strangerKinds: '', strangerExample: '' };
    return {
        strangers: strangers.map(n => JSON.stringify(n)).join(', '),
        strangerKinds: tags.join(', '),
        strangerExample: `${JSON.stringify(strangers[0])}: ${JSON.stringify(tags[0])}`,
    };
}
