import { debugLog } from './constants.js';
import { getContext } from '../../../../../st-context.js';

export function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escapes the five HTML-significant characters so untrusted text (AI output,
 * persona fields, user-typed names) can be interpolated into markup — or into
 * an attribute value — without breaking out of it.
 *
 * The previous map had its entity strings HTML-decoded by a bad edit
 * (`{ '&': '&', '<': '<', ... }`), which made this a no-op for
 * everything except the single quote. Every caller was effectively unescaped.
 */
export function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    };
    return String(unsafe).replace(/[&<>"']/g, m => map[m]);
}

/**
 * Robustly extracts a JSON object from text using brace matching.
 * @param {string} text 
 * @returns {string|null}
 */
export function extractJSON(text) {
    if (!text) return null;
    let i = text.indexOf('{');
    if (i === -1) return null;

    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let start = i;

    for (let j = i; j < text.length; j++) {
        const char = text[j];
        if (escapeNext) {
            escapeNext = false;
        } else if (char === '\\') {
            escapeNext = true;
        } else if (char === '"') {
            inString = !inString;
        } else if (!inString) {
            if (char === '{') depth++;
            else if (char === '}') {
                depth--;
                if (depth === 0) {
                    return text.substring(start, j + 1);
                }
            }
        }
    }
    
    // Fallback: if no matching brace, return from start to last }
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace > start) {
        return text.substring(start, lastBrace + 1);
    }
    
    return null;
}

function closeOpenStructures(str) {
    let repaired = str.trim();
    let inString = false;
    let escapeNext = false;
    const stack = [];

    for (let i = 0; i < repaired.length; i++) {
        const char = repaired[i];
        if (escapeNext) {
            escapeNext = false;
        } else if (char === '\\') {
            escapeNext = true;
        } else if (char === '"') {
            inString = !inString;
        } else if (!inString) {
            if (char === '{') {
                stack.push('}');
            } else if (char === '[') {
                stack.push(']');
            } else if (char === '}') {
                if (stack[stack.length - 1] === '}') {
                    stack.pop();
                }
            } else if (char === ']') {
                if (stack[stack.length - 1] === ']') {
                    stack.pop();
                }
            }
        }
    }

    if (inString) {
        repaired += '"';
    }

    repaired = repaired.replace(/,\s*$/, '');
    repaired = repaired.replace(/:\s*$/, '');

    // Close open structures in reverse order of the stack
    for (let i = stack.length - 1; i >= 0; i--) {
        repaired += stack[i];
    }

    return repaired;
}

function tryRepairAndParse(str) {
    let candidate = closeOpenStructures(str);
    try {
        return JSON.parse(candidate);
    } catch (e) {
        let current = str;
        for (let attempt = 0; attempt < 10; attempt++) {
            const lastComma = current.lastIndexOf(',');
            const lastOpenBrace = current.lastIndexOf('{');
            const lastOpenBracket = current.lastIndexOf('[');
            const cutIdx = Math.max(lastComma, lastOpenBrace, lastOpenBracket);
            
            if (cutIdx <= 0) break;
            
            current = current.substring(0, cutIdx);
            if (current.endsWith(',')) {
                current = current.slice(0, -1);
            }
            
            candidate = closeOpenStructures(current);
            try {
                return JSON.parse(candidate);
            } catch (err) {
                // Continue trimming
            }
        }
    }
    return null;
}

/**
 * A model's reply, parsed if it can be and repaired if it cannot.
 *
 * Three attempts in order: as written after trailing commas are removed; then
 * closeOpenStructures, which closes whatever the reply ran out of room to close - the common
 * failure, since a truncated object is what a token budget produces; then a last pass that
 * quotes bare keys.
 *
 * That last pass cannot tell a key from text inside a string value, so it will rewrite
 * `beta:` inside "alpha, beta: gamma" if it ever reaches it. **The safety is that JSON.parse
 * then rejects the result**, not that anything checks - mangling a string leaves unbalanced
 * quotes, so the parse throws and this returns null. That is worth knowing before changing
 * it: making the pass smarter without keeping the parse as the arbiter would turn a safe
 * failure into a quiet corruption.
 *
 * Measured against the shapes a model actually produces, it repairs trailing commas,
 * truncated objects, truncated strings and unquoted keys, and returns null - never wrong
 * data - for the two cases where unquoted keys and a colon inside a string value coincide.
 *
 * @param {string} jsonStr
 * @returns {any} The parsed value, or null when nothing safe could be recovered.
 */
export function safeJsonParse(jsonStr) {
    if (!jsonStr) return null;
    let repaired = jsonStr.trim();
    
    // Remove trailing commas in objects and arrays
    repaired = repaired.replace(/,(\s*[\]}])/g, '$1');
    
    try {
        return JSON.parse(repaired);
    } catch (e) {
        // Try truncated repair
        const fixed = tryRepairAndParse(repaired);
        if (fixed) return fixed;

        // Try more aggressive repair if needed, or just fail
        try {
            // Fix missing quotes on keys (simple cases)
            let fixedQuotes = repaired.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
            return JSON.parse(fixedQuotes);
        } catch (e2) {
            debugLog('JSON parse failed even after repair', e2, repaired);
            return null;
        }
    }
}

/**
 * Splits a "current/maximum" value into its halves. A plain value has no maximum.
 *
 * Lived in five places at once - status-diff, status-extractor, status-logic,
 * status-snapshots and here - and the copies had already drifted: some trimmed the whole
 * string before splitting, some trimmed the halves afterwards. What each caller does with
 * the halves is still its own business; only the parsing is shared.
 *
 * @param {*} value
 * @returns {{ current: string, max: string }}
 */
export function splitValue(value) {
    const text = value === undefined || value === null ? '' : String(value).trim();
    const slash = text.indexOf('/');
    if (slash === -1) return { current: text, max: '' };
    return { current: text.slice(0, slash).trim(), max: text.slice(slash + 1).trim() };
}

/**
 * Works out how to draw a stat as a meter.
 *
 * Lives here rather than in ui-shared so it stays dependency-free and testable: the
 * HUD and the in-chat tracker both need it, and ui-shared already participates in an
 * import cycle with ui-hud.
 *
 * Handles the shapes stats actually arrive in: "8/10", a bare "42", a negative value
 * for ranges like an affinity of -100..100, and prose the model invented. The old HUD
 * maths used /(\d+)/ which silently read "-40" as 40 - fine for HP, wrong for anything
 * that can go below zero.
 *
 * @see splitValue - the "cur/max" parsing itself, which five modules were each doing
 * their own slightly different way.
 *
 * @param {{ rawValue?: any, min?: any, max?: any }} input
 * @returns {{ current: number, min: number, max: number, percent: number, numeric: boolean }}
 */
/**
 * The ceiling a value carries in itself, or null when it carries none.
 *
 * Shared so the meter maths and the HUD's own "should this be a meter at all" test cannot
 * disagree. They did: computeStatBar learned that a denominator with a second slash is a
 * date rather than a ceiling, while meterHasCeiling went on running its own parseFloat -
 * which reads "01/2012" as 1 - so the HUD kept drawing a date as a full bar after the
 * maths had stopped treating it as one.
 *
 * @param {*} rawValue
 * @returns {number|null}
 */
export function ceilingFromValue(rawValue) {
    const { max } = splitValue(rawValue);
    // A denominator is one number. A second slash means this is a date, not "cur/max".
    if (String(max).includes('/')) return null;
    const parsed = parseFloat(max);
    return Number.isFinite(parsed) ? parsed : null;
}

export function computeStatBar({ rawValue, min, max }) {
    /* A date and a clock are not quantities, and both used to read as full meters.
     *
     * splitValue takes the FIRST slash, so "14/01/2012" came apart as 14 over "01/2012",
     * parseFloat made that ceiling 1, and 14 clamped to it at 100%. Worse, meterHasCeiling
     * asks the same parseFloat, so the HUD agreed it had a ceiling and drew the bar. A
     * second slash is the tell: a denominator is one number, not a date.
     *
     * "05:30 AM" went the other way - the digit matcher took "05" and, with no ceiling
     * anywhere, one was invented from the value itself. A colon is the tell there. "Morning"
     * was always handled, because it has no digits at all; a clock does.
     *
     * A unit is still allowed on either side: "3/4 cups" stays a meter at 75%.
     */
    const { current: currentText } = splitValue(rawValue);
    const impliedMax = ceilingFromValue(rawValue);

    /* Two shapes that carry digits without being quantities.
       A clock has a colon. A date has two separators, which is the same test status-clock
       makes before it will hand anything to Date.parse - and it has to cover the dash form
       as well as the slash, because "2012-01-14" carries no slash at all and would
       otherwise be read as a bare 2012 with an invented ceiling. Two separators is what
       keeps "-40" and "8-10" out of it. */
    const clocklike = String(currentText).includes(':');
    const datelike = /\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(String(rawValue ?? ''));
    const signed = (clocklike || datelike) ? null : String(currentText).match(/-?\d+(?:\.\d+)?/);
    const current = signed ? parseFloat(signed[0]) : NaN;

    const lower = Number.isFinite(parseFloat(min)) ? parseFloat(min) : 0;
    let upper = Number.isFinite(parseFloat(max)) ? parseFloat(max) : impliedMax;
    if (!Number.isFinite(upper)) upper = Number.isFinite(current) ? Math.max(current, lower + 1) : lower + 1;

    if (!Number.isFinite(current) || upper <= lower) {
        return { current: 0, min: lower, max: upper, percent: 0, numeric: false };
    }

    const clamped = Math.min(upper, Math.max(lower, current));
    const percent = ((clamped - lower) / (upper - lower)) * 100;
    return { current, min: lower, max: upper, percent, numeric: true };
}

/**
 * Fills in a field's Format string.
 *
 * `{{name}}` is what makes a label follow its field: it resolves to the field's current
 * name at render time, so renaming can never leave a label saying something the rest of
 * the extension has stopped calling it. A label written as literal text - "HP [{{HP}}]"
 * in a display template - is prose, and prose does not know it was renamed.
 *
 * The caller passes strings that are already fit for where they are going: the tracker box
 * hands in an HTML span for the value and escapes the name, the HUD hands in plain text.
 * Escaping here would have to guess which.
 *
 * @param {string} format e.g. `{{name}}: {{value}}`. Empty means just the value.
 * @param {{ value?: string, name?: string, max?: string }} parts
 * @returns {string}
 */
export function applyStatFormat(format, { value = '', name = '', max = '' } = {}) {
    let out = String(format || '{{value}}');
    out = out.split('{{value}}').join(value);
    out = out.split('{{name}}').join(name);
    // Only when there is one: a format asking for {{max}} on a stat without a ceiling
    // should not print the placeholder at people.
    out = out.split('{{max}}').join(max);
    return out;
}

/**
 * The persona filename behind a message's avatar, whatever shape it was written in.
 *
 * SillyTavern stamps the persona that wrote a message onto it as `force_avatar`, in one of
 * two forms: a thumbnail URL, `/thumbnail?type=persona&file=x.png`, which is what messages
 * carry now, and a plain `User Avatars/x.png` in older chats. Anything else - a character
 * portrait, a system avatar - is not a persona and comes back empty.
 *
 * @param {string} src
 * @returns {string} '' when this is not a persona avatar.
 */
export function personaFileFromAvatar(src) {
    const text = String(src ?? '');
    if (!text) return '';

    const query = text.indexOf('?');
    if (query >= 0) {
        const params = new URLSearchParams(text.slice(query + 1));
        if (params.get('type') !== 'persona') return '';
        return params.get('file') || '';
    }

    const prefix = 'User Avatars/';
    const at = text.indexOf(prefix);
    if (at < 0) return '';
    try {
        return decodeURIComponent(text.slice(at + prefix.length));
    } catch {
        // A stray % in a filename is not an escape, and is not worth throwing over.
        return text.slice(at + prefix.length);
    }
}

/**
 * Makes something that is not a button behave like one.
 *
 * Most of this interface is built from real `<button>` and `<select>` elements, which are
 * reachable and operable for free. A handful of controls are not, because they are an icon,
 * a card or a coloured cell rather than a label in a box: the tracker's four header icons,
 * the HUD portrait, the portrait carousel's arrows, the System Builder's tab bar.
 *
 * Those had a click handler and nothing else. Tab moved straight past them, so the only way
 * to reach them was with a mouse - and the character card was worse than that. It carried
 * role="button" and tabindex="0" but no key handler, so it took focus, announced itself as a
 * button, and did nothing when pressed. A promise with nothing behind it is worse than no
 * promise.
 *
 * Activation goes through `el.click()` rather than a copy of the handler, so whatever the
 * element already does on click is exactly what a keypress does. There is no second path to
 * keep in step.
 *
 * @param {HTMLElement} el
 * @param {{ label?: string, role?: string }} [options] `label` is what a screen reader
 *   announces, and defaults to the element's own tooltip - which is usually the only place
 *   an icon says what it does. `role` is 'button' unless the thing is really a tab.
 * @returns {HTMLElement} The same element, so this can wrap a creation expression.
 */
export function makeActivatable(el, { label, role = 'button' } = {}) {
    if (!el) return el;

    el.setAttribute('role', role);
    // Not overwritten: a caller may have put it in a particular tab order on purpose.
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;

    const announced = label ?? el.title ?? '';
    if (announced && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', announced);

    // So the focus ring can be styled once rather than per component.
    el.classList.add('sillynpc-activatable');

    if (el.dataset.activatable === 'true') return el;
    el.dataset.activatable = 'true';

    el.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        // Space scrolls the page and Enter can submit a surrounding form; a control that
        // did its job and also scrolled would be a worse answer than not working.
        event.preventDefault();
        el.click();
    });

    return el;
}
