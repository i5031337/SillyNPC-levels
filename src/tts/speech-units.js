import { getContext } from '../../../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { getActiveCharacters } from '../characters/characters.js';
import { getIgnoredSpeakerLabels } from '../story/speaker-labels.js';
import { resolvePersonaSpeaker } from '../tracker/status-logic.js';
import { messageBeats } from '../story/beats.js';
import { dialogueLabels } from '../chat/dialogue-line.js';
import { dialogueContentClone, discoverDialogueLines } from '../chat/dialogue-discovery.js';
import { dialogueRevision } from '../chat/dialogue-presentation.js';

const QUOTES = new Map([['"', '"'], ['“', '”'], ['«', '»'], ['「', '」'], ['『', '』'], ['＂', '＂']]);
const SKIP = 'pre, code, script, style, table, svg, canvas, video, summary, [hidden], '
    + '[data-sillynpc-hidden], .sillynpc-status-tracker-container, .sillynpc-review-panel, '
    + '.sillynpc-reader-report, .sillynpc-chat-avatar';

function quotedParts(value) {
    const source = String(value ?? '');
    const parts = [];
    for (let i = 0; i < source.length; i++) {
        const close = QUOTES.get(source[i]);
        if (!close) continue;
        const start = i;
        for (i++; i < source.length; i++) {
            if (source[i] === '\\') { i++; continue; }
            if (source[i] === close) {
                parts.push({ quoted: source.slice(start, i + 1), text: source.slice(start + 1, i) });
                break;
            }
        }
    }
    return parts;
}

const clean = value => String(value ?? '').replace(/\s+/gu, ' ').trim();

/** Split an accepted speaker line without giving surrounding action text the speaker voice. */
export function splitSpeechLine(line, match) {
    const label = dialogueLabels(line).find(item => item.name === match?.label?.name && item.start === 0);
    if (!label || !match.dialogue?.quotedText) return [{ kind: 'narration', text: clean(line) }];
    const body = line.slice(label.quoteStart);
    const parts = quotedParts(match.dialogue.quotedText);
    if (!parts.length) return [{ kind: 'narration', text: clean(body) }];
    const spans = [];
    let cursor = 0;
    for (const part of parts) {
        const at = body.indexOf(part.quoted, cursor);
        if (at < 0) return [{ kind: 'narration', text: clean(body) }];
        if (clean(body.slice(cursor, at))) spans.push({ kind: 'narration', text: clean(body.slice(cursor, at)) });
        if (clean(part.text)) spans.push({ kind: 'dialogue', text: clean(part.text) });
        cursor = at + part.quoted.length;
    }
    if (clean(body.slice(cursor))) spans.push({ kind: 'narration', text: clean(body.slice(cursor)) });
    return spans;
}

function speakableText(element) {
    const chunks = [];
    function visit(node) {
        if (node.nodeType === 3) { chunks.push(node.nodeValue); return; }
        if (node.nodeType !== 1 || node.matches?.(SKIP) || node.style?.display === 'none') return;
        if (node.tagName === 'BR') { chunks.push('\n'); return; }
        for (const child of node.childNodes) visit(child);
    }
    visit(element);
    return chunks.join('');
}

/** Read-only ordered narration and dialogue from the same rendered source as highlighting. */
export function readSpeechUnits(mesEl, {
    context = getContext(), characters = getActiveCharacters(), settings = getSettings(),
    ignoredLabels = getIgnoredSpeakerLabels(), personaFor = resolvePersonaSpeaker,
} = {}) {
    const container = mesEl?.querySelector('.mes_text');
    const idText = mesEl?.getAttribute('mesid');
    const id = Number(idText);
    if (!container || idText === null || idText === undefined || idText === ''
        || !Number.isInteger(id) || id < 0) return [];
    const revision = dialogueRevision(context, id);
    const units = [];
    for (const beat of messageBeats(container)) {
        if (beat.kind !== 'paragraph') continue;
        const clone = dialogueContentClone(beat.element);
        const matches = discoverDialogueLines(clone, {
            characters, caseInsensitive: settings.caseInsensitive, ignoredLabels, personaFor,
        });
        let nextMatch = 0;
        for (const source of speakableText(clone).split('\n')) {
            const line = clean(source);
            if (!line) continue;
            const label = dialogueLabels(line)[0];
            const match = matches[nextMatch];
            const recognized = label?.start === 0 && match?.label.name === label.name && match.dialogue?.text;
            const pieces = recognized ? splitSpeechLine(line, match) : [{ kind: 'narration', text: line }];
            if (recognized) nextMatch++;
            for (const piece of pieces) {
                if (!piece.text) continue;
                units.push({ messageId: id, revision, lineIndex: units.length, kind: piece.kind,
                    npcId: piece.kind === 'dialogue' && !match?.persona ? match?.card?.id || null : null,
                    speakerLabel: piece.kind === 'dialogue' ? match?.label.name || '' : '', text: piece.text });
            }
        }
    }
    return units;
}
