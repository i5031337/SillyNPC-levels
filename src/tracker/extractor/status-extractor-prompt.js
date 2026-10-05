import { collectionAppliesTo } from '../../core/collection-targets.js';
import { describeNpcTemplates, npcTemplates, npcStatsFor } from '../../core/npc-templates.js';
import { promptText } from '../../prompts/prompt-texts.js';
import { getContext } from '../../../../../../st-context.js';
import { debugLog } from '../../core/constants.js';
import { describeReaderStats } from '../stat-prompt-definitions.js';
import { strangerValues } from './status-extractor-schema.js';
import { describeCollections, buildDeltaExample, describeCurrentState, describeLimits } from './status-extractor-prompt-state.js';
import { describeAbsentButNamed } from './status-extractor-prompt-offstage.js';
import { describeNumericDeltas, numericDeltaNames, progressionXpName } from './status-extractor-deltas.js';
import { isTurnStat } from '../stat-update-policy.js';

/**
 * Extra notes for the reader, from whoever registered one.
 *
 * A registration rather than a list of things SillyNPC knows about, so something built
 * beside the tracker - a registry of places the story has been, say - can tell the reader
 * what it needs to without SillyNPC knowing it exists. Each provider is asked on every
 * extraction and may answer nothing.
 *
 * @type {Array<(context: { state: object, messageText: string }) => ({ heading: string, text: string }|null|undefined)>}
 */
const extractionNoteProviders = [];

/**
 * Adds a note to the reader's prompt, placed after the limits. The provider is called with
 * the state and the message being read, and returns `{ heading, text }` or nothing.
 *
 * @returns {() => void} Removes it again.
 */
export function registerExtractionNotes(provider) {
    if (typeof provider !== 'function') return () => {};
    extractionNoteProviders.push(provider);
    return () => {
        const at = extractionNoteProviders.indexOf(provider);
        if (at !== -1) extractionNoteProviders.splice(at, 1);
    };
}

/** Every registered note, as prompt sections. A provider that throws is skipped, not fatal. */
function describeExtractionNotes(state, messageText) {
    const sections = [];
    for (const provider of extractionNoteProviders) {
        try {
            const note = provider({ state, messageText });
            const heading = String(note?.heading ?? '').trim();
            const text = String(note?.text ?? '').trim();
            if (heading && text) sections.push(`\n### ${heading.toUpperCase()}\n${text}`);
        } catch (err) {
            debugLog('An extraction note could not be built', err);
        }
    }
    return sections.join('\n');
}

/**
 * Builds the extraction prompt.
 *
 * The lead-up matters. Tabletop play routinely announces a cost in one message, takes
 * the roll in the next and resolves in a third - and a character card that forbids
 * numbers in its prose means the resolving message says only that the spell landed.
 * Neither message alone is enough: the first names a cost nobody has paid yet, the last
 * shows the spend with no figure attached.
 *
 * Earlier messages are therefore supplied as context, explicitly marked as already
 * accounted for, so a cost can be attributed to the message that actually spent it
 * without being applied twice.
 *
 * @param {object} state
 * @param {string} messageText The message being extracted.
 * @param {object} trackerSettings
 * @param {string[]} [leadUp] Preceding messages, oldest first.
 */
/**
 * Builds the extraction prompt from the current state, recent messages and reader notes.
 */
// Exported for the tests: what reaches the model on every message is worth holding to
// a shape, and the vocabulary in it is the whole point of this function.
function readerValues(state, messageText, trackerSettings, leadUp = [], { strangers = [] } = {}) {
    /* One text, 'reader' in prompt-texts.js: every section of this request, in order. What
     * each section is for, since the wording is now yours to change:
     *
     * - WHAT YOU MAY CHANGE comes before any of the words it defines. The system prompt may be
     *   the shipped one or your own, and either way talks about stats and collections in the
     *   abstract; this says what they are here, and that the lists are closed - which is what
     *   stops a model reporting a plausible stat nobody configured.
     * - KNOWN, BUT NOT IN THE SCENE sits beside the state because it is state.
     * - The collections' fields come before the example, so they read as part of what is
     *   known. Without them a new item arrived with only the field the example showed.
     */
    return {
        state: describeCurrentState(state, trackerSettings) || '(empty)',
        offstage: describeAbsentButNamed(state, messageText, trackerSettings),
        limits: describeLimits(trackerSettings, state),
        npcFields: describeReaderStats(trackerSettings, { initializeNpc: true }),
        numericDeltas: describeNumericDeltas(state, trackerSettings),
        xpProgression: progressionXpName(trackerSettings, state)
            || (trackerSettings.npcTemplates || []).some(template => template.progression?.enabled) ? 'on' : '',
        // Whatever else has asked to be told to the reader - see registerExtractionNotes.
        notes: [describeNpcTemplates(), describeExtractionNotes(state, messageText)].filter(Boolean).join('\n'),
        ...strangerValues(strangers),
        collections: describeCollections(trackerSettings),
        collectionExample: buildDeltaExample(trackerSettings),
        minimalReply: buildMinimalExample(state, trackerSettings),
        changedReply: buildChangedExample(state, trackerSettings),
        newNpcReply: buildNewNpcExample(trackerSettings),
        earlier: leadUp.join('\n---\n'),
        message: messageText,
        reasons: trackerSettings.extractionReasons === false ? '' : 'on',
    };
}

export function buildUserPrompt(state, messageText, trackerSettings, leadUp = [], options = {}) {
    return promptText('reader', readerValues(state, messageText, trackerSettings, leadUp, options));
}

/**
 * The few messages before this one, trimmed so a long reply cannot dominate the prompt.
 * @param {string|number} messageId
 * @param {number} count How many preceding messages to include.
 * @returns {string[]} Oldest first, each labelled by speaker.
 */
export function collectLeadUp(messageId, count) {
    if (!count || count <= 0) return [];
    const chat = getContext()?.chat || [];
    const index = Number(messageId);
    if (!Number.isInteger(index) || index <= 0) return [];

    const out = [];
    for (let i = Math.max(0, index - count); i < index; i++) {
        const message = chat[i];
        if (!message || typeof message.mes !== 'string' || !message.mes.trim()) continue;
        const who = message.is_user ? 'Player' : 'Narrator';
        // Enough for a cost line or a roll result without pulling a whole scene back in.
        const text = message.mes.length > 1200 ? message.mes.slice(-1200) : message.mes;
        out.push(`[${who}] ${text}`);
    }
    return out;
}
/**
 * A quiet reply, in the cast this setup actually has.
 *
 * Small models copy the shape of an example far more reliably than they follow a
 * description of it, and an example is only useful if it is about them: a hard-coded
 * '"Stamina": "12/20"' teaches a model about a stat that may not exist here, and invites it
 * to report one that does not.
 *
 * The no-change case is common and should have a concrete example too.
 */
// Exported for the tests, as buildUserPrompt is.
export function buildMinimalExample(state, trackerSettings = {}) {
    const present = (state?.characters || []).map(c => c?.name).filter(Boolean);
    return JSON.stringify({
        ...(trackerSettings.extractionReasons === false ? {} : { why: {} }),
        global: {},
        player: {},
        characters: present.map(name => ({ name })),
    });
}

/** Show a populated NPC entry even when the current scene has no cast. */
export function buildNewNpcExample(trackerSettings = {}) {
    const template = npcTemplates()[0];
    const stats = Object.fromEntries((template ? npcStatsFor({ npcTemplateId: template.id }, trackerSettings) : trackerSettings.npcStats || [])
        .filter(stat => stat?.name && isTurnStat(stat))
        .map(stat => [stat.name, describeReaderStats({ npcStats: [stat] }, { initializeNpc: true })
            .replace(`- NPC.${stat.name}: `, '')]));
    const collections = Object.fromEntries((trackerSettings.collections || [])
        .filter(col => col?.id && collectionAppliesTo(col, 'npc', { npcTemplateId: template?.id || '' }))
        .map(col => {
            const primary = (col.fields || []).find(field => field.isPrimary)?.name || 'name';
            const item = Object.fromEntries((col.fields || [{ name: primary }]).map(field => [
                field.name, [String(field.hint || '').trim(),
                    field.name === primary ? 'identifies the item' : '',
                    field.type && field.type !== 'text' ? field.type : '',
                    field.type !== 'number' && field.options?.length ? `choose: ${field.options.join(', ')}` : '',
                ].filter(Boolean).join('; '),
            ]));
            return [col.id, { add: [item] }];
        }));
    return JSON.stringify({
        global: {},
        player: {},
        characters: [{
            name: '<exact NPC name from the story>',
            ...(template ? { npcTemplateId: template.id } : {}),
            ...(Object.keys(stats).length ? { stats } : {}),
            ...(Object.keys(collections).length ? { collections } : {}),
        }],
    }, null, 2);
}

/** Show a changed value only when this system has a stat to name in the example. */
function buildChangedExample(state, trackerSettings) {
    const playerStat = numericDeltaNames(trackerSettings.playerStats, state?.player?.stats)[0];
    const xpName = progressionXpName(trackerSettings, state);
    const cast = (state?.characters || []).filter(c => c?.name);
    const npc = cast[0];
    const npcStat = npc && numericDeltaNames(trackerSettings.npcStats, npc.stats)[0];
    const firstTurnStat = list => (list || []).find(stat => stat?.name && isTurnStat(stat) && !stat.locked
        && !['xp', 'level', 'level bonus'].includes(stat.name.toLowerCase()))?.name;
    const collectionFor = target => (trackerSettings.collections || [])
        .find(c => c?.id && (collectionAppliesTo(c, target, target === 'npc' ? npc || {} : undefined)));
    const collectionChange = (col, verb) => {
        if (!col) return undefined;
        const primary = (col.fields || []).find(f => f.isPrimary)?.name || 'name';
        return { [col.id]: verb === 'add'
            ? { add: [{ [primary]: '<item gained>' }] }
            : { remove: ['<item lost>'] } };
    };
    const player = {};
    if (playerStat) player.deltas = { [playerStat]: playerStat.toLowerCase() === xpName?.toLowerCase() ? 1 : -1 };
    else if (firstTurnStat(trackerSettings.playerStats)) {
        player.stats = { [firstTurnStat(trackerSettings.playerStats)]: '<new value>' };
    }
    const playerCollection = collectionChange(collectionFor('player'), 'add');
    if (playerCollection) player.collections = playerCollection;
    const characters = cast.map(actor => ({ name: actor.name }));
    if (npcStat) characters[0].deltas = { [npcStat]: -1 };
    else if (characters.length && firstTurnStat(trackerSettings.npcStats)) {
        characters[0].stats = { [firstTurnStat(trackerSettings.npcStats)]: '<new value>' };
    }
    const npcCollection = collectionChange(collectionFor('npc'), 'remove');
    if (npcCollection && characters.length) characters[0].collections = npcCollection;
    if (!Object.keys(player).length && !characters.some(c => c.deltas || c.collections)) return '';
    return JSON.stringify({
        ...(trackerSettings.extractionReasons === false ? {} : {
            why: playerStat ? { [`Player.${playerStat}`]: '<short quote from the latest message>' } : {},
        }),
        global: {},
        player,
        characters,
    });
}
