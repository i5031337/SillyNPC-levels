import { getSettings } from '../core/settings.js';
import { readerPromptTexts } from './prompt-texts-reader.js';
import { otherPromptTexts } from './prompt-texts-other.js';

export const PROMPT_TEXTS = [...readerPromptTexts, ...otherPromptTexts];
const BY_ID = new Map(PROMPT_TEXTS.map(entry => [entry.id, entry]));

/** The built-in wording for an id. Throws on a typo, which would otherwise send nothing. */
export function defaultPromptText(id) {
    const entry = BY_ID.get(id);
    if (!entry) throw new Error(`Unknown prompt text: ${id}`);
    return entry.text;
}

const SECTION = /^\s*\{\{([#/])(\w+)\}\}\s*$/;

/**
 * Fills a text, in one pass.
 *
 * A line that is only {{#name}} or {{/name}} opens or closes a section; the section is kept
 * when that value has something in it, and the marker lines themselves are never sent.
 * One pass, so a value that itself contains {{something}} - a message quoting a macro - is
 * sent as written rather than filled again. Only the keys given are filled; any other
 * double-brace word is left for SillyTavern's own macros. A line whose placeholders all
 * came out empty is dropped.
 */
export function fillPromptText(template, values = {}) {
    const known = (key) => Object.prototype.hasOwnProperty.call(values, key);
    const value = (key) => String(values[key] ?? '');
    const open = [];
    const out = [];
    for (const line of String(template).split('\n')) {
        const section = line.match(SECTION);
        if (section) {
            if (section[1] === '#') open.push(known(section[2]) && value(section[2]).trim() !== '');
            else open.pop();
            continue;
        }
        if (open.includes(false)) continue;
        const keys = [...line.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).filter(known);
        if (keys.length && keys.every(key => value(key) === '')) continue;
        out.push(line.replace(/\{\{(\w+)\}\}/g, (whole, key) => (known(key) ? value(key) : whole)));
    }
    return out.join('\n');
}

/** The text for an id - yours when you have written one, the built-in one otherwise - filled. */
export function promptText(id, values = {}) {
    const own = getSettings().promptTexts?.[id];
    const template = typeof own === 'string' && own.trim() ? own : defaultPromptText(id);
    return fillPromptText(template, values);
}
