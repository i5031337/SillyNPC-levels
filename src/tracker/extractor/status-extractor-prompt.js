import { promptText } from '../../prompts/prompt-texts.js';
import { getContext } from '../../../../../../st-context.js';
import { debugLog } from '../../core/constants.js';
import { profileFieldsForCard as fieldsForCard } from '../../core/profile-fields.js';
import { goalFields, goalValue } from '../goals.js';
import { getPlayerCard, findCardForName, describeNpcStatFields } from '../status-logic.js';
import { strangerValues } from './status-extractor-schema.js';
import { describeCollections, buildDeltaExample, describeCurrentState, describeLimits } from './status-extractor-prompt-state.js';
import { describeAbsentButNamed, describeLocked } from './status-extractor-prompt-offstage.js';
import { describeNumericDeltas, numericDeltaNames, progressionXpName } from './status-extractor-deltas.js';

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
     * - Goal and profile requests are grounded in the latest message by quoted evidence.
     */
    return {
        state: describeCurrentState(state, trackerSettings) || '(empty)',
        offstage: describeAbsentButNamed(state, messageText, trackerSettings),
        limits: describeLimits(trackerSettings, state),
        locked: describeLocked(trackerSettings),
        npcFields: describeNpcStatFields(trackerSettings),
        numericDeltas: describeNumericDeltas(state, trackerSettings),
        xpProgression: progressionXpName(trackerSettings, state) ? 'on' : '',
        // Whatever else has asked to be told to the reader - see registerExtractionNotes.
        notes: describeExtractionNotes(state, messageText),
        ...strangerValues(strangers),
        collections: describeCollections(trackerSettings),
        collectionExample: buildDeltaExample(trackerSettings),
        profileFields: describeOpenProfileFields(state),
        minimalReply: buildMinimalExample(state, trackerSettings),
        changedReply: buildChangedExample(state, trackerSettings),
        earlier: leadUp.join('\n---\n'),
        message: messageText,
        reasons: trackerSettings.extractionReasons === false ? '' : 'on',
        goals: describeGoalFields(state),
    };
}

function describeGoalFields(state) {
    const lines = [];
    const add = (actor, scope, name) => {
        for (const field of goalFields(scope)) {
            const current = goalValue(actor, field.id);
            lines.push(`- ${name}.${field.id}: ${current || '(empty)'}${field.guidance ? ` — ${field.guidance}` : ''}`);
        }
    };
    add(state?.player, 'player', state?.player?.name || 'Player');
    for (const actor of state?.characters || []) add(actor, 'npc', actor.name);
    return lines.join('\n');
}

export function buildUserPrompt(state, messageText, trackerSettings, leadUp = [], options = {}) {
    return promptText('reader', readerValues(state, messageText, trackerSettings, leadUp, options));
}

/** The level-up request gets the same scene and recent-message context as extraction. */
export function buildLevelBonusPrompt(state, messageText, trackerSettings, leadUp, details) {
    return promptText('levelBonus', {
        ...readerValues(state, messageText, trackerSettings, leadUp),
        state: describeCurrentState(state, trackerSettings, { includeAdvancement: true }),
        level: details.level,
        eligible: details.eligible,
        sheet: JSON.stringify(state?.player?.stats || {}),
        pendingChanges: JSON.stringify(details.pendingChanges),
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
 * Profile fields the active System permits the reader to change.
 *
 * The schema grew a `profile` key and nothing told the model it existed, which left a slot
 * with no instruction and no current value to compare against - it would have been writing
 * blind. Here rather than in the system prompt for the same reason that the reasons
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
        const open = fieldsForCard(card).filter(f => f.policy === 'replaceable' || f.policy === 'memory');
        for (const field of open) lines.push(`- ${label}.${field.id} (${field.policy})`);
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

/** Show a changed value only when this system has a stat to name in the example. */
function buildChangedExample(state, trackerSettings) {
    const stat = numericDeltaNames(trackerSettings.playerStats, state?.player?.stats)[0];
    if (!stat) return '';
    const xpName = progressionXpName(trackerSettings, state);
    const cast = (state?.characters || []).map(c => c?.name).filter(Boolean);
    return JSON.stringify({
        ...(trackerSettings.extractionReasons === false ? {} : {
            why: { [`Player.${stat}`]: '<short quote from the latest message>' },
        }),
        global: {},
        player: { deltas: { [stat]: stat.toLowerCase() === xpName?.toLowerCase() ? 1 : -1 } },
        characters: cast.map(name => ({ name })),
    });
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
