import { setUserAvatar, getUserAvatar } from '../../../../personas.js';
import { getAllCharacters, getLibraryCharacters } from './character-repository.js';
import { getIgnoredSpeakerLabels, normaliseSpeakerLabel } from './speaker-labels.js';

export function bind(deps) {
function findCardForName(name) {
    if (!name) return null;
    const lower = String(name).trim().toLowerCase();
    const cards = getAllCharacters();

    const byName = cards.find(c => (c.name || '').toLowerCase() === lower);
    if (byName) return byName;

    for (const card of cards) {
        for (const alias of card.aliases || []) {
            if (!alias?.pattern) continue;
            if (alias.isRegex) {
                try { if (new RegExp(alias.pattern, 'i').test(name)) return card; } catch { /* invalid regex */ }
            } else if (alias.pattern.trim().toLowerCase() === lower) {
                return card;
            }
        }
    }
    return null;
}

/**
 * The name a character should be stored under.
 *
 * Aliases collapse onto the card's own name, so a character the narrator calls
 * "Instructor Kovacs" in one line and "Mr. Kovacs" in the next is one row in the cast
 * rather than two. A name with no card is its own canonical form - unknown characters
 * are tracked too, and there is nothing to collapse them onto.
 *
 * @param {string} name
 * @returns {string}
 */
function resolveCanonicalName(name) {
    return findCardForName(name)?.name || String(name ?? '').trim();
}

/** This name is you. You are the player, and the player is not one of the cast. */
const CAST_PERSONA = 'persona';
/** Not a character at all - narration the reader mistook for somebody speaking. */
const CAST_EXCLUDED = 'excluded';

/**
 * Standing decisions about who is not an NPC in this chat.
 *
 * Kept in the chat rather than the settings, beside the item rules, and for the same
 * reason: "Alex is me" is true in this story, and another chat may have a real
 * character of that name. The extension cannot tell the two apart - which is why this is
 * a decision somebody makes rather than a name match - so it must not carry one chat's
 * answer into another.
 *
 * One map, name to reason, rather than two lists. Both reasons keep the name out of the
 * cast; recording which one it was is what lets the panel say why, and lets "this is me"
 * come to mean more later without every entry being re-decided.
 *
 * @returns {Record<string, 'persona'|'excluded'>} Keyed by lowercased canonical name.
 */
function getCastDecisions() {
    try {
        const map = deps.loadStateFromMetadata()?.castDecisions;
        return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    } catch {
        return {};
    }
}

/**
 * Records, or clears, what somebody is.
 *
 * @param {string} name
 * @param {'persona'|'excluded'|null} reason Null lets them back into the scene.
 * @returns {boolean} True when anything changed.
 */
function setCastDecision(name, reason) {
    const key = resolveCanonicalName(name).toLowerCase();
    if (!key) return false;

    const state = deps.loadStateFromMetadata();
    if (!state.castDecisions || typeof state.castDecisions !== 'object') state.castDecisions = {};

    if (reason === null || reason === undefined) {
        if (!(key in state.castDecisions)) return false;
        delete state.castDecisions[key];
    } else {
        if (state.castDecisions[key] === reason) return false;
        state.castDecisions[key] = reason;
        // Out of the scene now as well as in future: a decision that only takes effect
        // next time reads as having been ignored.
        state.characters = (state.characters || [])
            .filter(c => resolveCanonicalName(c.name).toLowerCase() !== key);
    }

    deps.saveStateToMetadata(state, { label: reason ? 'Cast decision' : 'Cast decision cleared' });
    return true;
}

/**
 * Your own portrait, for a speaker label you have said is you.
 *
 * "This is me" kept the name out of the cast and stopped there, so the chat still drew the
 * same blank stand-in it gives any name it has never heard of - which reads as the decision
 * having been ignored. The persona has a picture and a sheet already; this is what lets a
 * line the model wrote as "Alex:" use them.
 *
 * Deliberately outranks a card of the same name, as the decision does everywhere else: it
 * was made about this name, in this chat, by you.
 *
 * @param {string} name The speaker label as it was written.
 * @returns {{ name: string, imageUrl: string } | null} Null when this is not you.
 */
function resolvePersonaSpeaker(name) {
    // No blank-name guard: setCastDecision refuses to record one, so a nameless speaker
    // has no decision to find and falls out here like anybody else undecided.
    const canonical = resolveCanonicalName(name);
    if (getCastDecisions()[canonical.toLowerCase()] !== CAST_PERSONA) return null;

    const persona = deps.resolvePersonaAvatarAndName();
    // The player's own portrait wins, since that is the face they made for this character.
    // The persona picture stays as the fallback here rather than the blank the sheet
    // shows: a line in the chat needs something beside it either way.
    return {
        name: persona.name,
        imageUrl: deps.getPlayerImageUrl() || getUserAvatar(persona.avatar),
    };
}

/**
 * Whether this name is allowed to be a character in this chat.
 *
 * The one gate every admission goes through. There are three ways into the cast - the
 * chat decorator, the extractor, and an update that names somebody new - and they used to
 * disagree: the Not Speakers list guarded only the first, so a label you had excluded was
 * still reported into the scene by the second. Asking one question in one place is what
 * stops them drifting apart again.
 *
 * A card always wins, as it does for speaker detection: somebody genuinely called "Guide"
 * is not silenced by "guide" being on a list of things that are not people. A decision
 * made here is not overridden that way, because it was made about this character.
 *
 * @param {string} name
 * @returns {boolean}
 */
function mayJoinScene(name) {
    const canonical = resolveCanonicalName(name);
    if (!canonical) return false;
    if (getCastDecisions()[canonical.toLowerCase()]) return false;

    // Only for names nobody has made a card for.
    if (findCardForName(canonical)) return true;
    return !getIgnoredSpeakerLabels().has(normaliseSpeakerLabel(canonical));
}

/**
 * Folds cast rows that turn out to be the same character onto one another.
 *
 * Presence used to match on the raw detected name, so an alias produced a second row
 * with its own stats. Repairs existing state as well as preventing new duplicates: a
 * chat that already has both spellings heals on the next message.
 *
 * @param {object} state
 * @returns {boolean} True when anything was merged or renamed.
 */
function mergeDuplicateCharacters(state) {
    const kept = new Map();
    const out = [];
    let changed = false;

    for (const character of state.characters || []) {
        const canonical = resolveCanonicalName(character.name);
        const key = canonical.toLowerCase();
        const existing = kept.get(key);

        if (!existing) {
            if (character.name !== canonical) { character.name = canonical; changed = true; }
            kept.set(key, character);
            out.push(character);
            continue;
        }

        // Whichever was seen more recently describes the character better; the other
        // only fills gaps, so nothing recorded under either spelling is lost.
        const existingTick = Number(existing.lastSeenTick ?? -1);
        const incomingTick = Number(character.lastSeenTick ?? -1);
        const [fresh, stale] = incomingTick > existingTick ? [character, existing] : [existing, character];

        existing.stats = { ...stale.stats, ...fresh.stats };
        existing.collections = deps.mergeCollectionMaps(stale.collections || {}, fresh.collections || {});
        existing.lastSeenTick = Math.max(existingTick, incomingTick);
        if (fresh.boundTo !== undefined) existing.boundTo = fresh.boundTo;
        existing.name = canonical;
        changed = true;
    }

    if (changed) state.characters = out;
    return changed;
}

/**
 * Reconciles who is in the scene from what actually appeared in a message.
 *
 * Scene membership used to depend on the model maintaining an exact cast list while
 * also updating the scene-binding stat. Four failure modes came out of that, the worst
 * being that a narrative which moved to a new location without touching the binding
 * stat left every previous character in the tracker forever.
 *
 * Presence signals for one message are the union of everyone detected speaking in it
 * and (when the extraction pass runs) everyone it reports present - a character can be
 * in a scene without having a line. Anyone in neither, for castGraceMessages messages
 * running, leaves.
 *
 * Idempotent per message: re-rendering the same message does not advance the clock, and
 * a second call for the same message adds to that message's signals rather than
 * replacing them.
 *
 * Two kinds of signal arrive here. Speaker detection only knows who *spoke*, so a
 * character standing silently must not be dropped - hence the grace period. The
 * extraction pass answers a stronger question, "who is present", and returns a
 * complete cast; that can be trusted to remove people immediately, which is what makes
 * a scene change take effect at once rather than three messages later.
 *
 * @param {string[]} names Characters observed in this message.
 * @param {string|number} messageId The message these observations came from.
 * @param {{ authoritative?: boolean }} [options] authoritative:true means "this is the
 *   complete cast" - anyone absent leaves now, grace period notwithstanding.
 * @returns {boolean} True when the scene changed and was saved.
 */

Object.defineProperties(deps, {
    findCardForName: { enumerable: true, configurable: true, get: () => findCardForName },
    resolveCanonicalName: { enumerable: true, configurable: true, get: () => resolveCanonicalName },
    CAST_PERSONA: { enumerable: true, configurable: true, get: () => CAST_PERSONA },
    CAST_EXCLUDED: { enumerable: true, configurable: true, get: () => CAST_EXCLUDED },
    getCastDecisions: { enumerable: true, configurable: true, get: () => getCastDecisions },
    setCastDecision: { enumerable: true, configurable: true, get: () => setCastDecision },
    resolvePersonaSpeaker: { enumerable: true, configurable: true, get: () => resolvePersonaSpeaker },
    mayJoinScene: { enumerable: true, configurable: true, get: () => mayJoinScene },
    mergeDuplicateCharacters: { enumerable: true, configurable: true, get: () => mergeDuplicateCharacters },
});
}
