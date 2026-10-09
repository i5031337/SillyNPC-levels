import { dialogueLabels } from './dialogue-line.js';

const OPEN_QUOTES = new Map([['"', '"'], ['“', '”'], ['«', '»'], ['「', '」'], ['『', '』'], ['＂', '＂']]);
const BLOCKS = new Set(['P', 'BLOCKQUOTE', 'LI']);
const EXCLUDED = 'pre, code, script, style, table, svg, canvas, video, summary, [hidden], '
    + '[data-sillynpc-hidden], .sillynpc-status-tracker-container, .sillynpc-review-panel, '
    + '.sillynpc-reader-report, .sillynpc-chat-avatar';

export function cardForDialogueName(name, characters, caseInsensitive = false) {
    const fold = caseInsensitive ? value => String(value ?? '').toLowerCase() : value => String(value ?? '');
    for (const card of characters) {
        if (fold(card.name) === fold(name)) return card;
        for (const alias of card.aliases || []) {
            if (!alias?.pattern) continue;
            if (!alias.isRegex && fold(alias.pattern) === fold(name)) return card;
            if (!alias.isRegex) continue;
            try {
                if (new RegExp(`^(?:${alias.pattern})$`, caseInsensitive ? 'iu' : 'u').test(name)) return card;
            } catch { /* An invalid alias must not interrupt message processing. */ }
        }
    }
    return null;
}

/** Extract quoted speech on the recognized line, excluding prose and action spans. */
export function dialogueQuotes(source) {
    const line = String(source ?? '').split('\n', 1)[0].trimStart();
    const passages = [];
    let cursor = 0;
    if (!OPEN_QUOTES.has(line[cursor])) return null;
    while (cursor < line.length) {
        if (line[cursor] === '\\') { cursor += 2; continue; }
        if (line[cursor] === '*') {
            const end = line.indexOf('*', cursor + 1);
            if (end < 0) break;
            cursor = end + 1;
            continue;
        }
        if (!OPEN_QUOTES.has(line[cursor])) { cursor++; continue; }
        const start = cursor++;
        const close = OPEN_QUOTES.get(line[start]);
        let end = -1;
        for (; cursor < line.length; cursor++) {
            if (line[cursor] === '\\') { cursor++; continue; }
            if (line[cursor] === close) { end = cursor++; break; }
        }
        // A partial stream must not become a completed dialogue record.
        if (end < 0) return null;
        passages.push({ text: line.slice(start + 1, end), quotedText: line.slice(start, end + 1) });
    }
    if (!passages.length) return null;
    return {
        text: passages.map(part => part.text).join(' ').trim(),
        quotedText: passages.map(part => part.quotedText).join(' '),
    };
}

function startsLine(node) {
    let previous = node.previousSibling;
    while (previous?.nodeType === 3 && !previous.nodeValue.trim()) previous = previous.previousSibling;
    return !previous || previous.nodeName === 'BR';
}

function quotedElementFollows(node) {
    let next = node.nextSibling;
    while (next?.nodeType === 3 && !next.nodeValue.trim()) next = next.nextSibling;
    return next?.nodeName === 'Q' && OPEN_QUOTES.has((next.textContent || '')[0]);
}

function excluded(node, container) {
    for (let el = node.parentElement; el && el !== container; el = el.parentElement) {
        if (el.matches(EXCLUDED) || el.style?.display === 'none') return true;
        // Extension panels have classes that message markup cannot acquire.
        if ([...el.classList].some(name => name.startsWith('sillynpc-'))
            && !['sillynpc-speech-text', 'sillynpc-speech-block', 'sillynpc-speaker-name',
                'sillynpc-speaker-colon', 'sillynpc-ignore-model-color', 'sillynpc-multi-speaker']
                .some(name => el.classList.contains(name))) return true;
    }
    return false;
}

function dialogueSource(node, start, container) {
    let block = node.parentElement;
    while (block !== container && !BLOCKS.has(block.tagName)) block = block.parentElement;
    const range = container.ownerDocument.createRange();
    range.selectNodeContents(block);
    range.setStart(node, start);
    const fragment = range.cloneContents();
    const chunks = [];
    let quote = null;
    let sawQuote = false;
    let escaped = false;
    function append(text) {
        chunks.push(text);
        for (const char of text) {
            if (escaped) { escaped = false; continue; }
            if (char === '\\') { escaped = true; continue; }
            if (quote) { if (char === quote) quote = null; }
            else if (OPEN_QUOTES.has(char)) { quote = OPEN_QUOTES.get(char); sawQuote = true; }
        }
    }
    function visit(parent) {
        for (const child of parent.childNodes) {
            if (child.nodeType === 3) append(child.nodeValue);
            else if (child.nodeType === 1) {
                if (child.matches(EXCLUDED) || child.style?.display === 'none') continue;
                // Markdown actions become <em>; emphasis inside spoken quotes stays text.
                if (child.tagName === 'EM' && sawQuote && !quote) continue;
                if (child.tagName === 'BR' || BLOCKS.has(child.tagName)) append('\n');
                visit(child);
            }
        }
    }
    visit(fragment);
    return chunks.join('');
}

/** One discovery pass shared by highlighting and dialogue presentation. No DOM writes. */
export function discoverDialogueLines(container, {
    characters = [], caseInsensitive = false, ignoredLabels = new Set(), personaFor = () => null,
} = {}) {
    const walker = container.ownerDocument.createTreeWalker(container, 4);
    const lines = [];
    let node;
    while ((node = walker.nextNode())) {
        if (excluded(node, container)) continue;
        for (const label of dialogueLabels(node.nodeValue, startsLine(node), quotedElementFollows(node))) {
            const card = cardForDialogueName(label.name, characters, caseInsensitive);
            if (!card && ignoredLabels.has(label.name.trim().toLowerCase())) continue;
            const persona = personaFor(label.name);
            lines.push({ node, label, card, persona,
                dialogue: dialogueQuotes(dialogueSource(node, label.quoteStart, container)) });
        }
    }
    return lines;
}

/** Strip visual decorations from a clone so reads are independent of display settings. */
export function dialogueContentClone(container) {
    const clone = container.cloneNode(true);
    clone.querySelectorAll('.sillynpc-chat-avatar, .sillynpc-alias-link').forEach(el => el.remove());
    clone.querySelectorAll('.sillynpc-speech-text, .sillynpc-speaker-name, .sillynpc-speaker-colon')
        .forEach(wrapper => wrapper.replaceWith(...wrapper.childNodes));
    clone.normalize();
    return clone;
}
