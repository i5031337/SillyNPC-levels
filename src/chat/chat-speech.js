import { getSettings } from '../core/settings.js';
import { getIgnoredSpeakerLabels } from '../story/speaker-labels.js';
import { resolvePersonaSpeaker } from '../tracker/status-logic.js';
import { discoverDialogueLines } from './dialogue-discovery.js';
import { createAvatarImg } from './chat-portraits.js';

export function injectAtDialogueLines(container, characters, pickFace, isLastMessage) {
    const matches = discoverDialogueLines(container, {
        characters, caseInsensitive: getSettings().caseInsensitive,
        ignoredLabels: getIgnoredSpeakerLabels(), personaFor: resolvePersonaSpeaker,
    });
    const byNode = new Map();
    for (const match of matches) {
        if (!byNode.has(match.node)) byNode.set(match.node, []);
        byNode.get(match.node).push(match);
    }
    for (const [textNode, lines] of byNode) {
        const source = textNode.nodeValue;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        let changed = false;
        for (const { label, card, persona } of lines) {
            fragment.appendChild(document.createTextNode(source.slice(cursor, label.start)));
            fragment.appendChild(createAvatarImg({
                char: card,
                name: label.name,
                defaultImage: pickFace(label.name, card),
                isLastMessage,
                persona,
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
