import { fnv1a } from '../core/hash.js';
import { LOG_PREFIX, BUILT_IN_DEFAULT_AVATAR, paletteColorFor, debugLog } from '../core/constants.js';
import { getSettings } from '../core/settings.js';
import { getContext } from '../../../../../st-context.js';
import { findCharacter, getActiveCharacters, getChatCast } from '../characters/characters.js';
import { getAllCharacters } from '../characters/character-repository.js';
import { personaFileFromAvatar } from '../core/utils.js';
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


/**
 * A short key that changes when the picture does.
 *
 * This was the string's length, on the reasoning that a portrait can be a 165KB data URI
 * and hashing one on every menu visit would be waste. The reasoning was right and the
 * conclusion was wrong: two different pictures of a similar size have the same length, so
 * swapping one for another was invisible to the signature and the chat kept the old one
 * until the page was reloaded.
 *
 * Reads a bounded slice - the ends, where a data URI's header and payload tail live - plus
 * the length, so the cost does not grow with the image while the answer still depends on
 * its contents. A deliberate trade: two images could in principle collide, but they would
 * have to match in length and in both ends, which no two real portraits do.
 *
 * @param {string} url
 * @returns {string}
 */
function imageKey(url) {
    const text = String(url || '');
    if (!text) return '0';

    const EDGE = 256;
    const sample = text.length <= EDGE * 2
        ? text
        : text.slice(0, EDGE) + text.slice(-EDGE);

    // FNV-1a: spreads a change of one character. See hash.js.
    return `${text.length}.${fnv1a(sample).toString(36)}`;
}

/**
 * Everything that changes how the chat is decorated, as one comparable string.
 *
 * Closing the extension menu redrew every rendered message unconditionally - a hundred by
 * SillyTavern's default - so opening the menu, reading something and closing it again cost
 * a second of stalled scrolling for a chat that had not changed.
 *
 * It could not simply be dropped: editing a character's name or colour in the editor only
 * saves, and that close-time redraw is what applied it. Comparing a signature instead
 * catches every mutation without needing to find and instrument each one, which is the
 * failure mode a "something changed" flag has - the site nobody remembered to mark.
 *
 * Deliberately not a deep clone: this runs on every open and close, so it names the fields
 * that affect rendering and ignores the rest. A character's stats and collections are not
 * here, because changing them does not change how their name is drawn.
 *
 * @returns {string}
 */

export function chatRenderSignature() {
    const settings = getSettings();

    const characters = getAllCharacters().map(char => [
        char.id,
        char.name,
        char.color,
        char.category,
        char.imageFit,
        imageKey(char.imageUrl),
        // Shown in the tracker box, and editable from the character page - which
        // asked for a redraw that a signature blind to them would have declined.
        JSON.stringify(char.statusOverrides || {}),
        (char.aliases || []).map(alias => `${alias.pattern}~${alias.isRegex}`).join(','),
    ].join('|')).join(';');

    const decoration = [
        settings.enabled,
        settings.applyColors,
        settings.hideSpeakerNames,
        settings.caseInsensitive,
        settings.defaultImageFit,
        settings.avatarShape,
        settings.avatarSize,
        settings.colorStyle,
        settings.dividerStyle,
        settings.menuStyle,
        settings.speakerIgnoreList,
        (settings.defaultImages || []).map(i => i && i.src).join(','),
    ].join('|');

    /* The tracker box is drawn by a redraw, so what shapes it belongs here too - none of
       it was, which is why changing a stat's format left the chat showing the old one.

       Listed rather than hashing the whole statusTracker object, and the list is the
       point: that object also holds every hud* setting, and a HUD slider must not redraw
       a hundred messages. A stat definition is included whole because its name, format,
       visibility and colour all reach the box. */
    const tracker = getSettings().statusTracker || {};
    const trackerBox = [
        tracker.enabled,
        tracker.showOnlyAtBottom,
        tracker.customCSS,
        /* The layout itself, which shapes the box more than anything else here and was the
           one thing this list left out. The template box has no onChange, so a hand edit
           was saved and then ignored until something unrelated forced a redraw - Tidy
           labels and Reset both reprocess, which is why it went unnoticed. Watching it here
           rather than wiring the control also covers a template arriving from an import, a
           preset, or a system switch. */
        tracker.template,
        tracker.characterColumns,
        JSON.stringify(tracker.globalStats || []),
        JSON.stringify(tracker.playerStats || []),
        JSON.stringify(tracker.npcStats || []),
        JSON.stringify(tracker.collections || []),
        settings.trackerFontScale,
        // Not a setting at all: which face a stranger wears is chat metadata, and
        // "Redraw every face" changes it without touching anything else here.
        faceAssignmentVersion(),
    ].join('|');

    // Which characters this chat is scoped to decides who gets decorated at all.
    const cast = getChatCast();
    const scope = [
        (cast.categories || []).join(','),
        (cast.include || []).join(','),
        (cast.exclude || []).join(','),
        /* Who in this chat is you, and who is not a character at all. Saying "this is me" in
           the cast panel changes the portrait beside that name - and without this the redraw
           it asked for found nothing changed and declined, so the chat kept treating them as
           a stranger until a page reload. */
        JSON.stringify(getCastDecisions()),
    ].join('|');

    return `${characters}#${decoration}#${trackerBox}#${scope}`;
}


/**
 * The picture that belongs on this message, when it is one of the player's own.
 *
 * SillyTavern draws a user message with the persona avatar, and that is a different
 * element from the ones this file injects beside speaker labels. So making a portrait for
 * the player changed the sheet, the HUD and the inline avatars, and left the picture at
 * the side of their own messages as the persona.
 *
 * Only messages this persona wrote. A message carries the persona that wrote it, and
 * repainting an older one would put the current player's face on somebody else's line -
 * the same reason a cast decision is remembered per chat rather than matched by name.
 *
 * @param {{ is_user?: boolean, force_avatar?: string }} record A message, from the chat.
 * @returns {string} '' to leave SillyTavern's own picture alone.
 */
