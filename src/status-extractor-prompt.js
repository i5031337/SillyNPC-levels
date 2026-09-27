import { promptText } from './prompt-texts.js';
import { getContext } from '../../../../st-context.js';
import { debugLog, fieldsForCard, aiMayEditProfileField } from './constants.js';
import { activeThreads } from './threads.js';
import { currentMessageIndex } from './utils.js';
import { getPlayerCard, findCardForName, describeNpcStatFields } from './status-logic.js';
import { strangerValues } from './status-extractor-schema.js';
import { describeCollections, buildDeltaExample, describeCurrentState, describeLimits } from './status-extractor-prompt-state.js';
import { describeAbsentButNamed, describeLocked } from './status-extractor-prompt-offstage.js';

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
export function buildUserPrompt(state, messageText, trackerSettings, leadUp = [], { strangers = [] } = {}) {
    // What is already open, so the reader is not asked to find it again every message.
    //
    // The active ones only. This listed every open thread, which made the block grow with
    // the pile: a chat carrying eighty of them paid eighty lines here on every single
    // message, to stop the model re-proposing threads that mostly were not being sent to
    // it anyway. The ones worth naming are the ones in play, and addThread still refuses
    // an exact repeat of any of the rest.
    const openText = activeThreads(state, currentMessageIndex())
        .map(t => `  - "${t.quote}"`).join('\n');
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
     * - The reasons and threads asks are here rather than in the system prompt: your own
     *   extraction prompt replaces the shipped one outright, so anything added there would
     *   never reach anybody who has written their own. The threads ask names speech acts,
     *   which can be answered from one message, and its quote rule is what keeps it from
     *   becoming invented plot - a quote can be checked against the message.
     */
    return promptText('reader', {
        state: describeCurrentState(state, trackerSettings) || '(empty)',
        offstage: describeAbsentButNamed(state, messageText, trackerSettings),
        limits: describeLimits(trackerSettings, state),
        locked: describeLocked(trackerSettings),
        npcFields: describeNpcStatFields(trackerSettings),
        xpProgression: (trackerSettings.playerStats || []).some(stat => stat.name?.toLowerCase() === 'xp' && !stat.locked)
            && (trackerSettings.playerStats || []).some(stat => stat.name?.toLowerCase() === 'level') ? 'on' : '',
        // Whatever else has asked to be told to the reader - see registerExtractionNotes.
        notes: describeExtractionNotes(state, messageText),
        ...strangerValues(strangers),
        collections: describeCollections(trackerSettings),
        collectionExample: buildDeltaExample(trackerSettings),
        profileFields: describeOpenProfileFields(state),
        minimalReply: buildMinimalExample(state, trackerSettings),
        earlier: leadUp.join('\n---\n'),
        message: messageText,
        reasons: trackerSettings.extractionReasons === false ? '' : 'on',
        threads: trackerSettings.threadsEnabled === true ? 'on' : '',
        openThreads: openText,
    });
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
 * The unlocked profile fields, with what they currently say.
 *
 * The schema grew a `profile` key and nothing told the model it existed, which left a slot
 * with no instruction and no current value to compare against - it would have been writing
 * blind. Here rather than in the system prompt for the reason threads and the reasons
 * object are here: a user's own extraction prompt replaces the shipped one outright, and an
 * ask that lives only in the shipped text never reaches them.
 *
 * Only the unlocked ones. A locked field is dropped on apply whatever comes back, so
 * listing it would spend tokens inviting a change that is thrown away.
 *
 * @returns {string} Empty when nothing is unlocked, so the caller leaves the section out.
 */
function describeOpenProfileFields(state) {
    const lines = [];

    // Names only. The values are in the state block above, where every other fact about a
    // character lives - repeating them here sent an appearance twice in the same message.
    const describe = (card, label) => {
        const open = fieldsForCard(card).filter(f => aiMayEditProfileField(card, f.id));
        for (const field of open) lines.push(`- ${label}.${field.id}`);
    };

    if (state?.player?.name) {
        try { describe(getPlayerCard(), state.player.name); } catch { /* no persona */ }
    }
    for (const actor of state?.characters || []) {
        const card = findCardForName(actor?.name);
        if (card) describe(card, actor.name);
    }

    return lines.join('\n');
}

/**
 * A minimal reply, in the stats this setup actually has.
 *
 * Small models copy the shape of an example far more reliably than they follow a
 * description of it, and an example is only useful if it is about them: a hard-coded
 * '"Stamina": "12/20"' teaches a model about a stat that may not exist here, and invites it
 * to report one that does not.
 *
 * Placeholders where a value would be, so nothing here can be mistaken for a fact about the
 * scene - the same reasoning as buildDeltaExample, which does this for collections.
 */
// Exported for the tests, as buildUserPrompt is.
export function buildMinimalExample(state, trackerSettings) {
    const firstNamed = (list) => (list || []).map(s => s?.name).filter(Boolean)[0];

    const playerStat = firstNamed(trackerSettings.playerStats);
    const npcStat = firstNamed(trackerSettings.npcStats);
    const present = (state?.characters || []).map(c => c?.name).filter(Boolean);
    if (!playerStat && !npcStat && !present.length) return '';

    const characters = present.length
        ? present.slice(0, 2).map((name, i) => (i === 0 && npcStat
            ? `    { "name": ${JSON.stringify(name)}, "stats": { ${JSON.stringify(npcStat)}: "<new value>" } }`
            : `    { "name": ${JSON.stringify(name)} }`))
        : [];

    const example = '{\n'
        + '  "global": {},\n'
        + (playerStat
            ? `  "player": { "stats": { ${JSON.stringify(playerStat)}: "<new value>" } },\n`
            : '  "player": {},\n')
        + `  "characters": [\n${characters.join(',\n')}\n  ]\n}`;
    return example;
}

/**
 * Writes back any profile field the reader changed and is allowed to change.
 *
 * Deliberately outside applyUpdate. That writes the state - chat metadata, which the diff,
 * the review gate and the timeline all read - while a profile lives on the card, in
 * settings, shared by every chat. Routing one through the other would put global data on a
 * per-message path, which is how the player's stats once reached master storage.
 *
 * The lock is enforced here as well as in the schema. The schema only knows whether anybody
 * has unlocked anything; this knows which character and which field, and drops the rest even
 * when the model returns them anyway.
 *
 * Undoing is the swipe base's job: it snapshots every profile before the message runs, and
 * rebaseToSwipe puts them back. See snapshotProfiles.
 *
 * @returns {string[]} What changed, as "Name.Field", for the log.
 */
