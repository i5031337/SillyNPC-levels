const CUE = /^\s*\[\[NPC_VOICE speaker="([^"\r\n]{1,80})" description="([^"\r\n]{1,200})"\]\]\s*$/u;
const INLINE_CUE = /\[\[NPC_VOICE speaker="[^"\r\n]{1,80}" description="[^"\r\n]{1,200}"\]\]/gu;
export const voiceCueKey = value => String(value ?? '').trim().toLowerCase();

/** A complete line is data for one recognized speaker, never spoken dialogue. */
export function parseVoiceCues(source, records) {
    const speakers = new Set(records.filter(record => !record.isPersona && record.text)
        .map(record => voiceCueKey(record.speakerLabel)));
    const found = new Map();
    let fenced = false;
    for (const line of String(source ?? '').split(/\r?\n/u)) {
        if (/^\s*```/u.test(line)) { fenced = !fenced; continue; }
        if (fenced) continue;
        const match = line.match(CUE);
        if (!match) continue;
        const speaker = match[1].trim(), description = match[2].trim();
        const key = voiceCueKey(speaker);
        if (!key || !description || !speakers.has(key) || found.has(key)) continue;
        found.set(key, { speaker, description });
    }
    return [...found.values()];
}

/** Strip annotations from rendered text and from clones read by speech discovery. */
export function stripVoiceCueNodes(container) {
    if (!container?.ownerDocument) return;
    // SillyTavern turns the annotation's quoted values into separate <q> nodes.
    // Remove the complete block before walking text nodes.
    // Speech discovery also passes a paragraph itself as the clone root.
    if (container.matches?.('p, li, blockquote') && CUE.test(container.textContent)) {
        container.replaceChildren();
        return;
    }
    container.querySelectorAll('p, li, blockquote').forEach(block => {
        if (CUE.test(block.textContent)) block.remove();
    });
    const walker = container.ownerDocument.createTreeWalker(container, 4);
    const touched = new Set();
    let node;
    while ((node = walker.nextNode())) {
        if (!node.nodeValue.includes('[[NPC_VOICE') || node.parentElement?.closest('pre, code, script, style')) continue;
        const clean = node.nodeValue.replace(INLINE_CUE, '');
        if (clean !== node.nodeValue) { touched.add(node.parentElement); node.nodeValue = clean; }
    }
    for (const parent of touched) {
        const block = parent?.closest('p, li, blockquote');
        if (block && !block.textContent.trim() && !block.querySelector('img, audio, video')) block.remove();
    }
}
