import { getAllCharacters } from '../characters/character-repository.js';

/** Entries activated for the latest generation, shared by reader and scene prompts. */

/** @type {Array<object>} */
let activatedEntries = [];

/**
 * Records which entries the last generation activated.
 *
 * A character can be linked to a lorebook entry, so an entry firing is a strong signal that
 * the narrator is about to write that character in - which is precisely when both the reader
 * and the narrator need to know they already have a card.
 *
 * @param {Array<object>} entries
 */
export function noteActivatedLore(entries) {
    activatedEntries = Array.isArray(entries) ? entries : [];
}

/**
 * Characters whose linked entry fired this turn.
 *
 * Only cards that point at an entry. Anything written by hand in SillyTavern's own editor
 * belongs to nobody here and is left alone.
 *
 * @returns {object[]}
 */
export function charactersFromActivatedLore() {
    if (!activatedEntries.length) return [];
    const characters = getAllCharacters();
    return characters.filter(char => char.lorebook && activatedEntries.some(entry =>
        String(entry?.world ?? entry?.book ?? '') === String(char.lorebook.world)
        && String(entry?.uid) === String(char.lorebook.uid)));
}
