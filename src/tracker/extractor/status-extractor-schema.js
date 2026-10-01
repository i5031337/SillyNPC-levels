import { poolTags, strangerKind } from '../../characters/default-portraits.js';
import { numericDeltaNames, configuredXpName } from './status-extractor-deltas.js';
import { isTurnStat } from '../stat-update-policy.js';
import { goalFields } from '../goals.js';

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
export function buildExtractionSchema(trackerSettings, { strangers = [], state = null } = {}) {
    // Takes the stat definitions rather than their names, so a field that says how it
    // should be written can pass that on. A free-text field used to arrive as nothing but
    // a name and `{ type: 'string' }`, which is how one grew into a running log.
    const stringMap = (stats) => ({
        type: 'object',
        properties: Object.fromEntries((stats || [])
            .filter(stat => stat?.name && isTurnStat(stat))
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
    const xpName = configuredXpName(trackerSettings);
    const npcStatDefs = (trackerSettings.npcStats || []).filter(isTurnStat);
    const deltaMap = (keys) => ({
        type: 'object',
        properties: Object.fromEntries(keys.map(key => [key, { type: 'number' }])),
    });
    const worldDeltas = numericDeltaNames(globalStatDefs, state?.global);
    const playerDeltas = numericDeltaNames(playerStatDefs, state?.player?.stats);
    const npcDeltas = [...new Set((state?.characters || [])
        .flatMap(actor => numericDeltaNames(npcStatDefs, actor.stats)))];

    const playerCollections = collectionProps('player');
    const npcCollections = collectionProps('npc');

    const goalProps = scope => {
        const fields = goalFields(scope);
        return fields.length ? { type: 'object', properties: Object.fromEntries(fields.map(field => [
            field.id, { type: 'object', required: ['action', 'text', 'quote'], properties: {
                action: { type: 'string' }, text: { type: 'string' }, quote: { type: 'string' },
            } },
        ])) } : null;
    };

    return {
        type: 'object',
        // Required at the top level so a model cannot satisfy the schema with "{}",
        // which is exactly what happened while the schema was being rejected.
        required: ['global', 'player', 'characters'],
        properties: {
            ...(trackerSettings.extractionReasons === false ? {} : {
                why: { type: 'object', additionalProperties: { type: 'string' } },
            }),
            global: stringMap(globalStatDefs),
            ...(worldDeltas.length ? { globalDeltas: deltaMap(worldDeltas) } : {}),
            player: {
                type: 'object',
                properties: {
                    stats: stringMap(playerStatDefs.filter(stat => stat.name?.toLowerCase() !== xpName?.toLowerCase())),
                    ...(playerDeltas.length ? { deltas: deltaMap(playerDeltas) } : {}),
                    ...(playerCollections ? { collections: playerCollections } : {}),
                    ...(goalProps('player') ? { goals: goalProps('player') } : {}),
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
                        ...(npcDeltas.length ? { deltas: deltaMap(npcDeltas) } : {}),
                        ...(npcCollections ? { collections: npcCollections } : {}),
                        ...(goalProps('npc') ? { goals: goalProps('npc') } : {}),
                    },
                },
            },
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
