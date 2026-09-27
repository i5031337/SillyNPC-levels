import { fieldsForCard, isStaticField } from '../../core/constants.js';
import { statsInSystem, getPlayerCard, findCardForName, promptCeiling, highestCeiling } from '../status-logic.js';

/**
 * Renders the current state in the envelope the reply must use.
 *
 * Two lessons are baked in here. A prose summary invited the model to reply in that
 * shape ({"World":..., "Miller":...}), so the state is shown as JSON in the target
 * shape instead. And listing every field of every collection item made the exchange
 * long enough that replies were truncated before the "characters" array, so
 * collections are summarised as item names with quantities.
 */
/**
 * The collections and their fields, so a reply can use the right ones.
 *
 * Lived in the history scan, whose own comment explains why it exists: given only a prose
 * description, a 3B model invented its own keys and returned nothing usable. The
 * per-message extractor never had it, which is why the collections it produced were the
 * weakest part of its reply and why a newly created item arrived holding nothing but a
 * name - `name` was the only field it had ever been shown.
 *
 * @param {object} trackerSettings
 * @returns {string}
 */
/** A note, ending in a full stop, however the person who wrote it left it. */
function endsSentence(text) {
    const trimmed = String(text ?? '').trim();
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function describeCollections(trackerSettings) {
    const lines = [];
    for (const col of trackerSettings.collections || []) {
        const fields = (col.fields || []).map((f) => {
            const type = f.type && f.type !== 'text' ? ` (${f.type})` : '';
            const choices = (f.options || []).length ? ` [one of ${f.options.join(', ')}]` : '';
            // Said out loud, because the state no longer shows these on anything that is
            // already held. Without it a model could reasonably conclude they are not
            // wanted at all and stop supplying one when adding - and the first time an item
            // is added is the only chance the library gets to learn its description.
            const library = !f.isPrimary && f.isMultiline && isStaticField(f)
                ? ' [write it when adding; kept in the library afterwards]' : '';
            /* What the field is for, in the owner's words. A collection could say what it
               held and a stat could say how it was written, and a collection's fields had
               nowhere to say anything at all - so "value (number)" reached the reader as a
               number called Cost with nothing saying what it costs. */
            const says = String(f.hint ?? '').trim();
            return `${f.name}${type}${choices}`
                + `${f.isPrimary ? ' [identifies the item]' : ''}${library}`
                + `${says ? ` - ${endsSentence(says)}` : ''}`;
        }).join(', ');

        /* The label and the note, not just the id. An id is a key - "pictures" tells the
           model as little as a column name does, and the prompt used to send nothing else,
           which is why guidance about inventories had to stand in for saying what a
           collection actually holds. The label is already on every collection and was
           simply never sent; the note is optional and blank until somebody writes one. */
        const label = String(col.name ?? '').trim();
        const title = label && label.toLowerCase() !== String(col.id).toLowerCase()
            ? `"${col.id}" (${label})` : `"${col.id}"`;
        const note = String(col.hint ?? '').trim();

        lines.push(`- ${title} for ${col.target || 'all'}`
            + `${note ? ` - ${endsSentence(note)}` : ''}`
            + ` Fields: ${fields || 'name'}`);
    }
    return lines.join('\n');
}

/**
 * A worked example of a collection change, in the ids and fields actually configured.
 *
 * The prompt's only example was `{"add": [{"name": "Rope"}]}`, which taught the model that
 * an item has one field. The scan learned this lesson already - a filled-in example in the
 * user's own schema is the difference between a reply that fits and one that does not -
 * but it builds a *full list*, and the per-message extractor needs a delta.
 *
 * Placeholders sit in angle brackets so a small model cannot mistake one for content;
 * a value it must not guess is marked as such rather than shown as a plausible number.
 *
 * @param {object} trackerSettings
 * @returns {string}
 */
export function buildDeltaExample(trackerSettings) {
    const cols = trackerSettings.collections || [];
    if (!cols.length) return '';

    const col = cols[0];
    const primary = (col.fields || []).find(f => f.isPrimary)?.name || 'name';

    const item = {};
    for (const field of col.fields || [{ name: 'name' }]) {
        if (field.name === primary) {
            item[field.name] = '<exact name>';
        } else if (field.type === 'number') {
            item[field.name] = '<number, or omit if the message does not say>';
        } else if (field.type === 'boolean') {
            item[field.name] = '<true or false, or omit if the message does not say>';
        } else {
            item[field.name] = '<or omit if the message does not say>';
        }
    }

    /* All three verbs. The example is the only place the reply's shape is shown in the
       user's own names, so a verb missing from it is a verb the reader does not use. */
    const changed = { [primary]: '<exact name>', ...Object.fromEntries(
        Object.entries(item).filter(([key]) => key !== primary).slice(0, 1)
            .map(([key]) => [key, '<its new value>'])) };
    const shape = {
        [col.id]: {
            add: [item],
            remove: ['<exact name of something lost>'],
            ...(Object.keys(changed).length > 1 ? { update: [changed] } : {}),
        },
    };
    return JSON.stringify(shape, null, 2);
}

/**
 * An actor's collections, as the reader should see them.
 *
 * Module scope rather than a closure, because the characters who are named but not on
 * stage are rendered by the same code now. They used to get a hand-rolled one-line object
 * with their stats and nothing else, which read as a different kind of thing in a prompt
 * where everyone else was pretty-printed with their belongings.
 */
export function summariseCollections(actor, target, trackerSettings) {
        const cols = (trackerSettings.collections || [])
            .filter(c => c.target === 'all' || c.target === target);
        if (!cols.length) return undefined;
        const out = {};
        for (const col of cols) {
            const primary = (col.fields || []).find(f => f.isPrimary)?.name || 'name';
            /* Shown as objects rather than names, and whole. Collections used to render as
               bare strings - "spells": ["Fireball"] - so the model never saw that an item
               has a cost or a description, and had no shape to copy when adding one.

               Nothing is withheld any more. Descriptions used to be left out on the grounds
               that a static field is owned by the item library and written back over
               whatever the reader returns (getMergedItem), so the reader could not change
               one - which is true, and was the wrong conclusion. It cannot change a
               description; it has to READ one to judge what a message did with the thing.
               Choosing whether somebody just ate {"name":"Fekete Bomba","quantity":1} with
               nothing to say what that is, is guessing, and a reader that has to guess what
               an item is will also guess at its description and write one back.

               A zero is sent for the same reason: a spell that costs nothing and a spell
               whose cost nobody has filled in are different facts, and dropping the zero
               made them one. Only a field that is genuinely empty is left out, because an
               empty field has nothing to say. */
            out[col.id] = (actor?.collections?.[col.id] || []).map(item => {
                const name = item?.[primary] ?? item?.name ?? '';
                if (!name) return null;
                const shown = { [primary]: String(name) };
                for (const field of col.fields || []) {
                    if (field.name === primary) continue;
                    const value = item?.[field.name];
                    if (value === undefined || value === null || value === '') continue;
                    shown[field.name] = value;
                }
                return shown;
            }).filter(Boolean);
        }
        return out;
}

export function describeCurrentState(state, trackerSettings) {
    const summarise = (actor, target) => summariseCollections(actor, target, trackerSettings);

    const playerCollections = summarise(state.player, 'player');
    /* Filtered by the schema rather than spread wholesale. A stat deleted in System Builder
       leaves its value in the chat, and this described it to the reader on every extraction -
       inviting it to report on something applyUpdate would then refuse to write. See
       statsInSystem. */
    const shape = {
        global: statsInSystem(state.global, 'globalStats'),
        player: {
            stats: statsInSystem(state.player?.stats, 'playerStats'),
            ...(playerCollections ? { collections: playerCollections } : {}),
            // The player's four fields live on their persona record, not in the scene cast.
            ...profileBlock(safePlayerCard()),
        },
        characters: (state.characters || []).map(char => {
            const charCollections = summarise(char, 'npc');
            return {
                name: char.name,
                stats: statsInSystem(char.stats, 'npcStats'),
                ...(charCollections ? { collections: charCollections } : {}),
                ...profileBlock(findCardForName(char.name)),
            };
        }),
    };
    // Compact. This block is read, never copied: the reply shape comes from the schema
    // and from the two worked examples, which keep their indentation for exactly that
    // reason. Pretty-printing it spent a newline and an indent on every key, which on a
    // real chat was a third of the largest section of the prompt.
    return JSON.stringify(shape);
}

/**
 * A character's four profile fields, ready to spread into their record.
 *
 * Every field that has a value, not only the unlocked ones. The state block is meant to be
 * a complete picture of somebody, and it was the one place in the whole prompt that was
 * missing a piece: their stats and their belongings were there, and who they are was not.
 * What the reader may *change* is a separate question, answered by its own section.
 *
 * Absent rather than empty when nothing is written, so a card nobody has filled in does not
 * carry a block of blank strings in every message.
 */
export function profileBlock(card) {
    const profile = {};
    for (const field of fieldsForCard(card)) {
        const value = String(card?.profile?.[field.id] ?? '').trim();
        if (value) profile[field.id] = value;
    }
    return Object.keys(profile).length ? { profile } : {};
}

/** getPlayerCard, which needs a persona and is called where there may not be one. */
function safePlayerCard() {
    try { return getPlayerCard(); } catch { return null; }
}

/**
 * Ceilings the model must respect.
 *
 * These used to come only from the configured maxStatValue, which contradicts the
 * state whenever a stat has grown in play: a character whose Energy reached 120/120
 * was shown "Energy: 120/120" alongside "Energy: 0..80", and the model resolved the
 * contradiction by trusting the limit - silently dragging the character back to 78/80
 * and destroying the progression.
 *
 * The live value wins. Once play has raised a ceiling, that is the real ceiling; the
 * configured maximum is only a starting point for stats that have never moved.
 *
 * @param {object} trackerSettings
 * @param {object} state Current tracker state, used for live ceilings.
 */
export function describeLimits(trackerSettings, state) {
    const describe = (list, label, valueFor) => {
        const entries = (list || [])
            .filter(stat => label !== 'Player limits' || stat.name.toLowerCase() !== 'xp')
            .map(stat => ({
                name: stat.name,
                /* The value's own ceiling whenever the actor holds a value, and the
                   configured one only when nobody does. It used to fall back whenever the
                   live reading came back blank, which cannot tell "this stat has no
                   ceiling" from "nobody has this stat" - so a ceiling cleared on the sheet
                   was replaced here by the configured one and announced to the model. */
                max: promptCeiling(stat, valueFor(stat.name)),
                min: stat.min,
            }))
            .filter(e => e.max || (e.min !== undefined && e.min !== ''))
            .map(e => `${e.name}: ${e.min !== undefined && e.min !== '' ? e.min : 0}..${e.max || '?'}`);
        return entries.length ? `${label}: ${entries.join(', ')}` : '';
    };

    /**
     * The stats that may only hold certain values.
     *
     * A refused value costs a whole message of tracking for that field, so naming the
     * vocabulary is worth the tokens: the guard is what makes the list true, and this
     * is what stops it having to.
     */
    const describeChoices = (list, label) => {
        const entries = (list || [])
            .filter(stat => (stat?.options || []).length)
            .map(stat => `${stat.name}: one of ${stat.options.join(', ')}`);
        return entries.length ? `${label}: ${entries.join('; ')}` : '';
    };

    /**
     * How a free-text field should be written, in the user's own words.
     *
     * Sent here as well as in the schema because the schema is optional - Use Schema is a
     * setting, and several backends ignore or reject one - while this block is always
     * part of the prompt. A field with nothing to say adds nothing.
     */
    const describeShapes = (list, label) => {
        const entries = (list || [])
            .filter(stat => stat?.name && String(stat.hint ?? '').trim())
            .map(stat => {
                const limit = Number(stat.maxLength);
                const cap = Number.isFinite(limit) && limit > 0
                    ? ` (at most ${limit} characters)`
                    : '';
                return `${stat.name}: ${String(stat.hint).trim()}${cap}`;
            });
        return entries.length ? `${label}: ${entries.join('; ')}` : '';
    };

    return [
        describe(trackerSettings.playerStats, 'Player limits',
            (name) => state?.player?.stats?.[name]),
        describe(trackerSettings.npcStats, 'Character limits',
            (name) => highestCeiling(state?.characters, name)),
        describeChoices(trackerSettings.globalStats, 'World values'),
        describeChoices(trackerSettings.playerStats, 'Player values'),
        describeChoices(trackerSettings.npcStats, 'Character values'),
        describeShapes(trackerSettings.globalStats, 'How to write world values'),
        describeShapes(trackerSettings.playerStats, 'How to write player values'),
        describeShapes(trackerSettings.npcStats, 'How to write character values'),
    ].filter(Boolean).join('\n');
}

