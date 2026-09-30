const DIALOGUE_LINE = /(^|\n)([ \t]*)([\p{L}][\p{L}\p{M}\p{N} ._'’\-]{0,59})[ \t]*:[ \t]*(?=["“«「『＂]|$)/gu;

export function dialogueLabels(text, startsLine = true, quoteFollows = false) {
    const source = String(text ?? '');
    const labels = [];
    for (const match of source.matchAll(DIALOGUE_LINE)) {
        if (match.index === 0 && !match[1] && !startsLine) continue;
        const quoteStart = match.index + match[0].length;
        // SillyTavern moves quoted speech into a following <q>, leaving the
        // label and colon at the end of this text node.
        if (quoteStart === source.length && !quoteFollows) continue;
        const name = match[3].trim();
        if (!name) continue;
        const start = match.index + match[1].length + match[2].length;
        labels.push({ name, start, end: start + match[3].length, quoteStart });
    }
    return labels;
}
