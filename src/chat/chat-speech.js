import { getSettings } from '../core/settings.js';
import { getIgnoredSpeakerLabels, normaliseSpeakerLabel } from '../story/speaker-labels.js';
import { dialogueLabels } from './dialogue-line.js';
import { createAvatarImg } from './chat-portraits.js';

function startsLine(node) {
    let previous = node.previousSibling;
    while (previous?.nodeType === Node.TEXT_NODE && !previous.nodeValue.trim()) {
        previous = previous.previousSibling;
    }
    return !previous || previous.nodeName === 'BR';
}

function quotedElementFollows(node) {
    let next = node.nextSibling;
    while (next?.nodeType === Node.TEXT_NODE && !next.nodeValue.trim()) next = next.nextSibling;
    return next?.nodeName === 'Q' && /^["“«「『＂]/u.test(next.textContent || '');
}

function cardForName(name, characters) {
    const fold = getSettings().caseInsensitive
        ? value => String(value ?? '').toLowerCase()
        : value => String(value ?? '');
    for (const card of characters) {
        if (fold(card.name) === fold(name)) return card;
        for (const alias of card.aliases || []) {
            if (!alias.pattern) continue;
            if (!alias.isRegex && fold(alias.pattern) === fold(name)) return card;
            if (!alias.isRegex) continue;
            try {
                if (new RegExp(`^(?:${alias.pattern})$`, getSettings().caseInsensitive ? 'iu' : 'u').test(name)) return card;
            } catch { /* invalid alias */ }
        }
    }
    return null;
}

export function injectAtDialogueLines(container, characters, pickFace, isLastMessage) {
    const ignored = getIgnoredSpeakerLabels();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    for (const textNode of nodes) {
        const source = textNode.nodeValue;
        const labels = dialogueLabels(source, startsLine(textNode), quotedElementFollows(textNode));
        if (!labels.length) continue;

        const fragment = document.createDocumentFragment();
        let cursor = 0;
        let changed = false;
        for (const label of labels) {
            const card = cardForName(label.name, characters);
            if (!card && ignored.has(normaliseSpeakerLabel(label.name))) continue;
            fragment.appendChild(document.createTextNode(source.slice(cursor, label.start)));
            fragment.appendChild(createAvatarImg({
                char: card,
                name: label.name,
                defaultImage: pickFace(label.name, card),
                isLastMessage,
            }));
            const name = document.createElement('span');
            name.className = 'sillynpc-speaker-name';
            name.textContent = source.slice(label.start, label.end);
            if (card && getSettings().hideSpeakerNames) name.style.display = 'none';
            fragment.appendChild(name);

            const colon = document.createElement('span');
            colon.className = 'sillynpc-speaker-colon';
            colon.textContent = source.slice(label.end, label.quoteStart);
            if (card && getSettings().hideSpeakerNames) colon.style.display = 'none';
            fragment.appendChild(colon);
            cursor = label.quoteStart;
            changed = true;
        }
        if (!changed) continue;
        fragment.appendChild(document.createTextNode(source.slice(cursor)));
        textNode.parentNode.replaceChild(fragment, textNode);
    }
}
