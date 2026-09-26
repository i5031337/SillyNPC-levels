import { fnv1a } from './hash.js';
import { LOG_PREFIX, BUILT_IN_DEFAULT_AVATAR, paletteColorFor, debugLog } from './constants.js';
import { getSettings } from './settings.js';
import { getContext } from '../../../../st-context.js';
import { findCharacter, getActiveCharacters, getChatCast } from './characters.js';
import { getAllCharacters } from './character-repository.js';
import { characterPatternSignature } from './character-scope.js';
import { escapeRegExp, personaFileFromAvatar } from './utils.js';
import { processStatusUpdate, renderStatusTrackerBox, redrawStatusBoxes } from './status-ui.js';
import {
    registerActiveCharacter, reconcileScenePresence, resolvePersonaSpeaker,
    getPlayerImageUrl, getCurrentPersonaKey, getCastDecisions,
} from './status-logic.js';
import { faceFor, faceAssignmentVersion } from './default-portraits.js';
import { getIgnoredSpeakerLabels, normaliseSpeakerLabel } from './speaker-labels.js';
import { charactersMentionedIn } from './mentions.js';
import { triggerReprocess, setReprocessCallback } from './reprocess.js';
import { updateHUD } from './ui-hud.js';
import { getTrackerView, setTrackerView, nextTrackerView } from './tracker-view.js';
import { eventSource } from '../../../../events.js';
import { messageBeats, MESSAGE_RENDERED_EVENT } from './beats.js';
import { injectAtBoldSpeakers, injectAtPlainTextSpeakers, replaceTextNodeWithMatches } from './chat-speech.js';

export function playerPortraitFor(record) {
    if (!getSettings().enabled) return '';
    if (!record?.is_user) return '';

    // No force_avatar means SillyTavern drew whoever is active, which is this player.
    const wrote = personaFileFromAvatar(record.force_avatar);
    if (wrote && wrote !== getCurrentPersonaKey()) return '';

    // Empty when no portrait has been made, which is how the persona picture stays.
    return getPlayerImageUrl();
}

/**
 * Puts that picture on the message, and takes it off again when it should not be there.
 *
 * SillyTavern's own src is remembered at the moment it is replaced, and forgotten again
 * the moment it is put back. Remembering it on every pass instead would leave a stale
 * copy: switch persona and SillyTavern redraws the same element with a new picture, which
 * we would then "restore" over the top of.
 *
 * @param {Element} mesEl
 */
export function applyPlayerPortrait(mesEl) {
    const img = mesEl.querySelector('.mesAvatarWrapper .avatar img');
    if (!img) return;

    const context = getContext();
    const record = (context?.chat || [])[Number(mesEl.getAttribute('mesid'))];
    const wanted = playerPortraitFor(record);

    if (wanted) {
        if (img.dataset.sillynpcAvatar === undefined) {
            img.dataset.sillynpcAvatar = img.getAttribute('src') || '';
        }
        if (img.getAttribute('src') !== wanted) img.setAttribute('src', wanted);
        return;
    }

    // Nothing of ours belongs here. Undefined means we never replaced anything, so
    // whatever is on screen is SillyTavern's and is already right.
    const original = img.dataset.sillynpcAvatar;
    if (original === undefined) return;
    delete img.dataset.sillynpcAvatar;
    if (img.getAttribute('src') !== original) img.setAttribute('src', original);
}

/**
 * Walk a rendered message and inject character avatars next to speaker labels.
 * @param {Element} mesEl
 */
export function injectCharacterImages(mesEl) {
    const textContainer = mesEl.querySelector('.mes_text');
    if (!textContainer) return;

    // Strip prior decorations so re-renders are idempotent.
    clearDecorations(textContainer);
    mesEl.removeAttribute('data-sillynpc-processed');

    if (!getSettings().enabled) return;

    // Scoped to this chat: a character belonging to another story is neither decorated
    // here nor reported present, which is what stops a new chat inheriting the last
    // one's cast. The manage grid still shows everybody.
    const allCharacters = getActiveCharacters();

    const messageId = mesEl.getAttribute('mesid');
    const context = getContext();
    const chat = (context && Array.isArray(context.chat)) ? context.chat : [];
    const isLastMessage = chat.length > 0 ? Number(messageId) >= chat.length - 1 : true;

    // Bound to this message, because which face a stranger wears depends on when they
    // were last seen - and a picture picked fresh on every render would reshuffle the
    // whole chat on each redraw.
    const pickFace = (name, char) => faceFor({ char, name, messageId: Number(messageId) });

    pendingActiveCharacters = new Set();
    try {
        injectAtBoldSpeakers(textContainer, allCharacters, pickFace, isLastMessage);
        injectAtPlainTextSpeakers(textContainer, allCharacters, pickFace, isLastMessage);
    } finally {
        const names = pendingActiveCharacters;
        pendingActiveCharacters = null;

        if (getSettings().statusTracker?.castMode === 'speakers') {
            // Who appeared in this message is the authority for who is in the scene.
            // Idempotent per message id, so re-rendering does not advance the clock.
            if (isLastMessage) reconcileScenePresence([...names], messageId);
        } else {
            for (const name of names) registerActiveCharacter(name);
        }
    }

    // After all avatars are placed, decorate each speaker's containing paragraph.
    decorateSpeechBlocks(textContainer);
    
    // Mark as processed
    mesEl.setAttribute('data-sillynpc-processed', 'true');
}

export function clearDecorations(textContainer) {
    textContainer.querySelectorAll('.sillynpc-speech-text, .sillynpc-speaker-name, .sillynpc-speaker-colon').forEach(wrapper => {
        const parent = wrapper.parentNode;
        while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
        parent.removeChild(wrapper);
    });
    textContainer.querySelectorAll('strong, b, em, i').forEach(el => {
        el.style.removeProperty('display');
    });
    textContainer.normalize();
    textContainer.querySelectorAll('.sillynpc-chat-avatar').forEach(el => el.remove());
    textContainer.querySelectorAll('.sillynpc-alias-link').forEach(el => el.remove());
    // Turning colouring off has to give the model's own colours back, so this is undone
    // here with every other decoration.
    textContainer.querySelectorAll('.sillynpc-ignore-model-color').forEach(el => {
        el.classList.remove('sillynpc-ignore-model-color');
    });
    textContainer.querySelectorAll('.sillynpc-speech-block').forEach(p => {
        p.classList.remove(
            'sillynpc-speech-block',
            'sillynpc-multi-speaker',
            'divider-subtle', 'divider-bold', 'divider-dashed', 'divider-none',
            'color-text', 'color-background', 'color-border', 'color-gradient', 'color-all'
        );
        p.style.removeProperty('--sillynpc-color');
        p.removeAttribute('data-sillynpc-char');
    });
}

/**
 * Whether this speaker's name can be replaced by their portrait.
 *
 * Hiding a name is a trade: the portrait says who is speaking instead. Without a card
 * there is nothing to trade for - every uncarded speaker is given the same fallback
 * picture - so hiding the name swapped something readable for something indistinguishable,
 * with the name left only in the tooltip. The setting's own description said names go "in
 * favor of the visual avatars", and in that case there was no such avatar.
 *
 * The other decoration path never had this fault: replaceTextNodeWithMatches builds its
 * matches from the card map, so every name it hides has a card behind it.
 *
 * @param {object|null|undefined} char The speaker's card, when they have one.
 * @returns {boolean}
 */
export function shouldHideSpeakerName(char) {
    return !!getSettings().hideSpeakerNames && !!char;
}

/**
 * Names seen on the last message during the current injectCharacterImages() pass.
 * Flushed once at the end rather than written per avatar.
 * @type {Set<string>}
 */
let pendingActiveCharacters = null;

/**
 * The one place a speaker's portrait is built. Both injection paths come through here,
 * which is why the "is this me?" question is asked here rather than at each of them.
 *
 * Exported so it can be tested: injecting avatars needs a parsed document, but deciding
 * which picture to draw does not.
 */
export function createAvatarImg({ char, defaultImage, name, isLastMessage }) {
    const img = document.createElement('img');
    const shape = getSettings().avatarShape || 'rounded';
    const size = getSettings().avatarSize || 'medium';
    img.className = `sillynpc-chat-avatar shape-${shape} size-${size}`;
    img.setAttribute('tabindex', '0');
    img.setAttribute('role', 'button');
    img.onerror = () => img.remove();

    const globalFit = getSettings().defaultImageFit || 'contain';
    const effectiveFit = (char?.imageFit) || globalFit;
    img.style.objectFit = effectiveFit;

    // Asked here rather than at each caller, so both the bold path and the plain-text one
    // get it - and so a decision made about a name that also has a card still wins.
    const label = char?.name || name || '';
    const persona = label ? resolvePersonaSpeaker(label) : null;

    if (persona) {
        img.src = persona.imageUrl;
        img.alt = persona.name || label;
        img.title = `${persona.name || label} — this is you; click to open your sheet`;
        img.dataset.persona = 'true';
        // A persona is not one of the cast, but say the name anyway and let mayJoinScene
        // be the single place that decides who joins.
        if (label) {
            img.dataset.charName = label;
            if (isLastMessage && pendingActiveCharacters) pendingActiveCharacters.add(label);
        }
        // A persona whose picture file has gone - or who has never had one, since the
        // fallback name ST reports is not a real file - would otherwise hit the onerror
        // above and vanish, which looks exactly like the decision doing nothing.
        img.onerror = () => {
            img.onerror = () => img.remove();
            img.src = defaultImage || BUILT_IN_DEFAULT_AVATAR;
        };
    } else if (char) {
        img.src = char.imageUrl || defaultImage || BUILT_IN_DEFAULT_AVATAR;
        img.alt = char.name || '';
        img.title = `${char.name || 'unnamed'} — click to edit card`;
        img.dataset.charId = char.id;
        if (char.name) {
            img.dataset.charName = char.name;
            if (isLastMessage && pendingActiveCharacters) {
                pendingActiveCharacters.add(char.name);
            }
        }
    } else {
        img.src = defaultImage || BUILT_IN_DEFAULT_AVATAR;
        img.alt = name || '';
        img.title = name
            ? `${name} — click to create and Fill; Shift-click to link as alias`
            : 'click to create and Fill; Shift-click to link as alias';
        img.setAttribute('aria-label', img.title);
        img.dataset.default = 'true';
        if (name) {
            img.dataset.charName = name;
            // A speaker with no card is still present in the scene. Only characters
            // with cards used to be reported, which is why a new cast could appear in
            // the message while the tracker still listed the previous scene.
            if (isLastMessage && pendingActiveCharacters) {
                pendingActiveCharacters.add(name);
            }
        }
    }
    return img;
}

/**
 * The colour a speech block should carry.
 *
 * A card's own colour always wins. Without one, the speaker's name is enough: they had an
 * avatar and a block but plain text, which is the gap a persona prompt full of <font> tags
 * was filling, and the name gives a shade that is the same in every message.
 *
 * @param {string} [charId] From the avatar, when the speaker has a card.
 * @param {string} [charName] From the avatar, carded or not.
 * @returns {{ color: string, charId: string|null } | null} Null means leave it plain.
 */
export function resolveSpeakerColor(charId, charName) {
    const char = charId ? findCharacter(charId) : null;
    if (char?.color) return { color: char.color, charId: char.id };

    if (!getSettings().autoColorUnknownSpeakers || !charName) return null;
    return { color: paletteColorFor(charName), charId: null };
}

/**
 * Stops a colour the model wrote from overriding the one the extension chose.
 *
 * An inline <font> sits inside the speech block and beats the colour set on it, so the
 * Character Coloring Logic setting quietly stopped applying to any line a persona prompt
 * had told the model to colour.
 *
 * A class rather than an edit to the message: this pass runs over the rendered DOM without
 * re-reading the message text, so anything destructive could not be undone until
 * SillyTavern next re-rendered. clearDecorations takes the class off again, which is what
 * makes turning the setting off give the model's colours straight back.
 *
 * @param {Element} block
 * @returns {number} How many tags were neutralised.
 */
export function neutraliseModelColors(block) {
    if (!getSettings().applyColors) return 0;
    const tags = block?.querySelectorAll?.('font[color]') || [];
    let count = 0;
    for (const tag of tags) {
        tag.classList.add('sillynpc-ignore-model-color');
        count += 1;
    }
    return count;
}
/**
 * Colours each speaker's paragraph.
 *
 * Reads the beats rather than finding the paragraphs itself. It used to walk the avatars
 * and climb each one to its block, which is the same walk messageBeats now does - and two
 * walks answering "whose paragraph is this" is how they start answering differently. That
 * has already cost this project twice, with the HUD and with deleted stats, so the walk is
 * shared the moment there is a second caller for it.
 *
 * Narration beats are skipped here and only here: a paragraph with nobody speaking has no
 * colour to take. It is still a beat, and the visual novel uses it.
 */
function decorateSpeechBlocks(container) {
    const settings = getSettings();
    for (const beat of messageBeats(container)) {
        if (beat.isNarration) continue;
        const block = beat.element;
        // A message with no block elements is one beat whose element is the container
        // itself, and painting the whole message as one speaker's is not what that means.
        if (block === container) continue;

        // Reset classes to ensure setting changes apply
        block.classList.remove(
            'sillynpc-speech-block', 
            'divider-subtle', 'divider-bold', 'divider-dashed', 'divider-none',
            'color-text', 'color-background', 'color-border', 'color-gradient', 'color-all'
        );
        block.style.removeProperty('--sillynpc-color');

        block.classList.add('sillynpc-speech-block', `divider-${settings.dividerStyle || 'subtle'}`);

        if (!beat.ambiguous) {
            wrapSingleSpeakerBlock(block, beat.avatars[0]);
        } else {
            block.classList.add('sillynpc-multi-speaker');
        }

        if (settings.applyColors) {
            const matchedAvatar = block.querySelector('.sillynpc-chat-avatar[data-char-id]');
            const named = block.querySelector('.sillynpc-chat-avatar[data-char-name]');
            const colour = resolveSpeakerColor(matchedAvatar?.dataset.charId, named?.dataset.charName);
            if (colour) {
                block.style.setProperty('--sillynpc-color', colour.color);
                if (colour.charId) block.setAttribute('data-sillynpc-char', colour.charId);
                block.classList.add(`color-${settings.colorStyle || 'text'}`);
            }
        }

        neutraliseModelColors(block);
    }
}

function wrapSingleSpeakerBlock(block, avatar) {
    if (avatar.parentNode !== block) {
        block.insertBefore(avatar, block.firstChild);
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'sillynpc-speech-text';
    const others = [...block.childNodes].filter(n => n !== avatar);
    for (const node of others) wrapper.appendChild(node);
    block.appendChild(wrapper);
}


