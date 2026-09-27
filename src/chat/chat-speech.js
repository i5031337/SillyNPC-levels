import { fnv1a } from '../core/hash.js';
import { LOG_PREFIX, BUILT_IN_DEFAULT_AVATAR, paletteColorFor, debugLog } from '../core/constants.js';
import { getSettings } from '../core/settings.js';
import { getContext } from '../../../../../st-context.js';
import { findCharacter, getActiveCharacters, getChatCast } from '../characters/characters.js';
import { getAllCharacters } from '../characters/character-repository.js';
import { characterPatternSignature } from '../characters/character-scope.js';
import { escapeRegExp, personaFileFromAvatar } from '../core/utils.js';
import { processStatusUpdate, renderStatusTrackerBox, redrawStatusBoxes } from '../tracker/ui/status-ui.js';
import {
    registerActiveCharacter, reconcileScenePresence, resolvePersonaSpeaker,
    getPlayerImageUrl, getCurrentPersonaKey, getCastDecisions,
} from '../tracker/status-logic.js';
import { faceFor, faceAssignmentVersion } from '../characters/default-portraits.js';
import { getIgnoredSpeakerLabels, normaliseSpeakerLabel } from '../story/speaker-labels.js';
import { charactersMentionedIn } from '../story/mentions.js';
import { triggerReprocess, setReprocessCallback } from './reprocess.js';
import { updateHUD } from '../ui/hud/ui-hud.js';
import { getTrackerView, setTrackerView, nextTrackerView } from '../tracker/tracker-view.js';
import { eventSource } from '../../../../../events.js';
import { messageBeats, MESSAGE_RENDERED_EVENT } from '../story/beats.js';
import { getOptimizedPatterns } from './chat-signature.js';
import { createAvatarImg, shouldHideSpeakerName } from './chat-portraits.js';

export function injectAtBoldSpeakers(container, characters, pickFace, isLastMessage) {
    const candidates = Array.from(container.querySelectorAll('strong, b, em, i'));
    const ignored = getIgnoredSpeakerLabels();

    for (const el of candidates) {
        const text = el.textContent;
        if (!text || !text.trim()) continue;
        const colonNode = findFollowingColonNode(el);
        if (!colonNode) continue;

        const trimmed = text.trim();
        const char = findCharacterByExactName(trimmed, characters);
        // A card always wins: being named after a stat does not stop somebody existing.
        // Without a card, a label the system already knows as a property is a property.
        if (!char && ignored.has(normaliseSpeakerLabel(trimmed))) continue;

        const avatar = char
            ? createAvatarImg({ char, defaultImage: pickFace(char.name, char), isLastMessage })
            : createAvatarImg({ defaultImage: pickFace(trimmed), name: trimmed, isLastMessage });

       if (el.parentNode) {
            el.parentNode.insertBefore(avatar, el);
            if (!char && trimmed && characters.some(card => card.name)) {
                const link = document.createElement('button');
                link.type = 'button';
                link.className = 'sillynpc-alias-link';
                link.dataset.charName = trimmed;
                link.title = `Link ${trimmed} as an alias of an existing NPC`;
                link.setAttribute('aria-label', link.title);
                link.innerHTML = '<i class="fa-solid fa-link" aria-hidden="true"></i>';
                el.parentNode.insertBefore(link, el);
            }
        }

        if (shouldHideSpeakerName(char)) {
            el.style.display = 'none';
            wrapAndHideColon(colonNode);
        }
    }
}

function wrapAndHideColon(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        const match = text.match(/^\s*:/);
        if (match) {
            const span = document.createElement('span');
            span.className = 'sillynpc-speaker-colon';
            span.style.display = 'none';
            span.textContent = match[0];
            const remaining = document.createTextNode(text.slice(match[0].length));
            node.parentNode.insertBefore(span, node);
            node.parentNode.replaceChild(remaining, node);
        }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
        node.style.display = 'none';
    }
}

function findFollowingColonNode(el) {
    let node = el.nextSibling;
    let parent = el.parentNode;

    while (true) {
        while (node) {
            const text = (node.nodeType === Node.TEXT_NODE) ? node.nodeValue : (node.nodeType === Node.ELEMENT_NODE ? node.textContent : null);
            if (text === null) {
                node = node.nextSibling;
                continue;
            }
            const trimmed = text.replace(/^\s+/, '');
            if (trimmed.length === 0) {
                node = node.nextSibling;
                continue;
            }
            return trimmed.startsWith(':') ? node : null;
        }
        
        // If we ran out of siblings, try going up a level, as long as we're not at the top text container
        if (!parent || parent.classList?.contains('mes_text') || parent.tagName === 'P') {
            break;
        }
        node = parent.nextSibling;
        parent = parent.parentNode;
    }
    return null;
}

export function injectAtPlainTextSpeakers(container, characters, pickFace, isLastMessage) {
    const patterns = getOptimizedPatterns(characters);
    if (!patterns.combinedRegex && patterns.regexAliases.length === 0) return;

    const textNodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName;
            if (tag === 'STRONG' || tag === 'B' || tag === 'EM' || tag === 'I') {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    for (const node of textNodes) {
        replaceTextNodeWithMatches(node, patterns, pickFace, isLastMessage);
    }
}

export function replaceTextNodeWithMatches(node, patterns, pickFace, isLastMessage) {
    const text = node.nodeValue;
    if (!text) return;
    const hideNames = getSettings().hideSpeakerNames;
    const { combinedRegex, charMap, regexAliases, caseInsensitive } = patterns;

    const matches = [];

    // 1. Match plain names using the combined regex (high performance)
    if (combinedRegex) {
        combinedRegex.lastIndex = 0;
        let m;
        while ((m = combinedRegex.exec(text)) !== null) {
            const matchedName = m[1];
            const char = charMap.get(caseInsensitive ? matchedName.toLowerCase() : matchedName);
            if (char) {
                matches.push({ start: m.index, end: m.index + m[0].length, char });
            }
            if (m.index === combinedRegex.lastIndex) combinedRegex.lastIndex++;
        }
    }

    // 2. Match regex aliases (slower, but usually few)
    for (const ra of regexAliases) {
        ra.regex.lastIndex = 0;
        let m;
        while ((m = ra.regex.exec(text)) !== null) {
            matches.push({ start: m.index, end: m.index + m[0].length, char: ra.char });
            if (m.index === ra.regex.lastIndex) ra.regex.lastIndex++;
        }
    }

    if (!matches.length) return;

    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    const deduped = [];
    let lastEnd = -1;
    for (const m of matches) {
        if (m.start >= lastEnd) {
            deduped.push(m);
            lastEnd = m.end;
        }
    }

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const m of deduped) {
        if (m.start > cursor) {
            fragment.appendChild(document.createTextNode(text.slice(cursor, m.start)));
        }
        fragment.appendChild(createAvatarImg({
            char: m.char, defaultImage: pickFace(m.char?.name, m.char), isLastMessage,
        }));
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'sillynpc-speaker-name';
        nameSpan.textContent = text.slice(m.start, m.end);
        if (hideNames) nameSpan.style.display = 'none';
        fragment.appendChild(nameSpan);
        
        cursor = m.end;
    }
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    node.parentNode.replaceChild(fragment, node);
}

function findCharacterByExactName(text, characters) {
    const patterns = getOptimizedPatterns(characters);
    const caseInsensitive = getSettings().caseInsensitive;
    const target = caseInsensitive ? text.toLowerCase() : text;

    // 1. Fast lookup via map
    const char = patterns.charMap.get(target);
    if (char) return char;

    // 2. Fallback to regex aliases
    for (const ra of patterns.regexAliases) {
        // We need a version of the regex that matches the whole string
        try {
            const fullRegex = new RegExp(`^(?:${ra.regex.source.replace(/\\s\*:$/, '')})$`, ra.regex.flags.replace('g', ''));
            if (fullRegex.test(text)) return ra.char;
        } catch { /* skip */ }
    }

    return null;
}

