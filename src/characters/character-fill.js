import { promptText } from '../prompts/prompt-texts.js';
import { getContext } from '../../../../../st-context.js';
import { fillTemplate } from '../prompts/macros.js';
import { getSettings, saveSettings } from '../core/settings.js';
import { hintFor } from '../core/constants.js';
import { profileFieldsForCard as fieldsForCard } from '../core/profile-fields.js';
import { requestExtraction, coerceToUpdate } from '../tracker/extractor/status-extractor.js';
import { describeTrackedFacts, describeProfile, buildLoreExcerpt } from '../api/api.js';
import { tryAutoSyncLorebook } from '../lore/lorebook.js';
import { charactersMentionedIn } from '../story/mentions.js';
import { getPersonaData } from '../tracker/status-logic.js';
import { readLoreEntry } from './character-fill-lore.js';
import { syncProfileToLore } from '../lore/lore-sync.js';
export { readLoreEntry, fillLore } from './character-fill-lore.js';

/**
 * Filling in a character card that was created from a chat, or by hand, and is empty.
 *
 * Fill writes the description and lore together, then draws a portrait if requested.
 */

/**
 * What this card is missing, and what filling it would do.
 *
 * Read before anything is sent, so the plan shown to the user is the plan that runs. A
 * stage already done is reported as done rather than quietly skipped, because "nothing
 * happened" and "there was nothing to do" look the same from outside.
 *
 * @param {object} char
 * @returns {Promise<{ lore: object, image: object, anything: boolean }>}
 */
export async function auditCharacter(char) {
    const missingProfile = missingProfileFields(char);
    const hasLore = char?.lorebook && String(await readLoreEntry(char)).trim();
    const lore = hasLore && !missingProfile.length
        ? { done: true, summary: 'Description and lore are complete.' }
        : { done: false, summary: 'Write or complete the description and lore in one request.' };

    const image = char?.imageUrl
        ? { done: true, summary: 'Already has a portrait.' }
        : { done: false, summary: 'No portrait. Will draw one.' };

    const wanted = (stage) => !stage.done;
    return {
        lore, image,
        anything: wanted(lore) || wanted(image),
    };
}

/**
 * Which profile fields this card has nothing for. A blank string counts as nothing.
 *
 * The lore writer may seed a blank field; existing values remain in place.
 */
export function missingProfileFields(char) {
    const profile = char?.profile || {};
    return fieldsForCard(char).filter(field => !String(profile[field.id] ?? '').trim());
}

/**
 * What there is to go on, before anything is sent.
 *
 * Four cases, and the one that mattered is the last: a character with no entry who has not
 * appeared yet. Fill used to send the recent story anyway, and the recent story is the
 * reader's own messages and their persona - so the model described the persona, because
 * that was the only person in front of it. Withholding the story is what makes that
 * impossible rather than merely discouraged.
 *
 * An entry the reader wrote by hand but never linked counts. fillLore has always looked
 * for one; fillProfile never did, so a perfectly good description sat unread unless the
 * link had been made by hand.
 *
 * @param {object} char
 * @returns {Promise<{ story: string, lore: string, personaDescription: string, enough: boolean }>}
 */
export async function fillSources(char) {
    // The linked entry, or one that matches by name and was never linked to.
    let lore = await readLoreEntry(char);
    if (!lore && !char?.lorebook) {
        if (await tryAutoSyncLorebook(char, { silent: true })) {
            lore = await readLoreEntry(char);
        }
    }

    /* Name and non-regex aliases, on word boundaries, honouring the case-insensitive
       setting - charactersMentionedIn is that matcher and is what decides who the tracker
       reads about, so Fill agreeing with it is worth more than a second rule that could
       disagree. Passed this one character rather than the cast: the question is whether
       *they* are in it. */
    const excerpt = buildLoreExcerpt(getContext()?.chat || []);
    const mentioned = excerpt.text
        ? charactersMentionedIn(excerpt.text, [char]).length > 0
        : false;

    const persona = char.isPlayer ? getPersonaData() : null;
    const personaDescription = persona && (!char.personaKey || char.personaKey === persona.avatar)
        ? String(persona.description || '').trim() : '';

    return {
        story: mentioned ? excerpt.text : '',
        lore,
        personaDescription,
        enough: Boolean(mentioned || lore || personaDescription),
    };
}

/**
 * The ask, generated from the field list so a field cannot exist without being asked for.
 */
export function buildProfilePrompt(char, wanted, sources) {
    const values = { name: char.name };

    // Named so the story cannot be mistaken for a description of them. The reader writes
    // most of what is in an excerpt, so their persona is the best-described person in it
    // by some distance, and the subject may be a passing mention.
    const persona = getPersonaData();
    if (persona?.name && persona.name !== char.name) {
        values.persona = persona.name;
    }

    // Everything except what is being rewritten. See describeProfile.
    const rewriting = new Set(wanted.map(f => f.id));
    const known = describeProfile(char, rewriting);
    values.known = known;

    // Recent story is sent only when this character is mentioned; lore supports it.
    if (sources.story) {
        values.story = sources.story;
    }

    if (sources.lore) {
        values[sources.story ? 'loreBeside' : 'lore'] = sources.lore;
    }

    values.facts = describeTrackedFacts(char, rewriting);
    values.fields = wanted.map(field => `- ${field.id}: `
        + fillTemplate(hintFor(field), { name: char.name }))
        .join('\n');

    // One text, 'profileRequest' in prompt-texts.js.
    let prompt = promptText('profileRequest', values);
    if (char.isPlayer && sources.personaDescription) {
        prompt += `\n\nSillyTavern persona description for ${char.name}:\n${sources.personaDescription}`;
    }
    return prompt;
}

/**
 * Fills in who somebody is, from the story, their entry and what the tracker knows.
 *
 * Only blanks. A field you wrote yourself is the one thing on the card that is certainly
 * right, and a fill that overwrote it would make the button dangerous rather than useful -
 * Empty fields are supplied by the lore writer during Fill.
 *
 * Writes straight to the card rather than through applyUpdate: a profile is not tracker
 * state, and routing it through the update path is exactly how it would end up somewhere
 * the per-message reader could reach it.
 *
 * @returns {Promise<{ ok: boolean, filled: string[], reason?: string }>}
 */
export async function fillProfile(char, { fields = null } = {}) {
    /* Named fields are rewritten whether or not they already say something.
     *
     * Fill on its own has always been a fill-in-the-blanks button, and it stays one: pressing
     * it must not silently rewrite a personality somebody sat down and wrote, which is what
     * the plan dialog promises. But there was no deliberate path either, so redoing one field
     * meant clearing the box by hand first, per field and per character. Asking for a field by
     * name is that path, and every caller of it confirms first. */
    const wanted = Array.isArray(fields) && fields.length
        ? fieldsForCard(char).filter(f => fields.includes(f.id))
        : missingProfileFields(char);
    if (wanted.length === 0) return { ok: true, filled: [] };

    const sources = await fillSources(char);
    if (!sources.enough) {
        return {
            ok: true, filled: [],
            reason: `Nothing to go on: ${char.name} has no lorebook entry and is not `
                + 'mentioned in the recent story. Write them into a message, or give them '
                + 'an entry, and try again.',
        };
    }

    const prompt = buildProfilePrompt(char, wanted, sources);
    const raw = await requestExtraction(
        prompt, null, getSettings().statusTracker, promptText('profileSystem'), { usageKind: 'fill' });
    const answer = coerceToUpdate(raw);

    if (!answer || typeof answer !== 'object') {
        return { ok: false, filled: [], reason: 'The reader replied with something that could not be read.' };
    }

    if (!char.profile || typeof char.profile !== 'object') char.profile = {};
    const filled = [];
    for (const field of wanted) {
        const value = answer[field.id];
        if (value === undefined || value === null || String(value).trim() === '') continue;
        char.profile[field.id] = String(value).trim();
        filled.push(field.label);
    }

    if (!filled.length) {
        return { ok: true, filled: [], reason: 'The material did not say enough to fill anything.' };
    }

    saveSettings();
    await syncProfileToLore(char);
    return { ok: true, filled };
}
