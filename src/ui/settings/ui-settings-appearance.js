import { getSettings, saveSettings } from '../../core/settings.js';
import { pickAndProcessImages, resolveImageFolder, describeSaveDestination } from '../../core/utils.js';
import { promptListAvailable } from '../../prompts/prompt-slot.js';
import { applyDialogueFormatPrompt } from '../../prompts/dialogue-format.js';
import { applyNarratorRulesPrompt } from '../../prompts/narrator-rules.js';
import { buildSettingSelect, buildSettingToggle, buildSettingTextArea, buildSettingSlider, buildSettingNumber, updateAllExtensionThemes, applyPortraitFraming, applySpeechPadding } from '../shared/ui-shared.js';
import { renderBanList } from '../shared/ui-banlist.js';
import { world_names } from '../../../../../../world-info.js';
import { extension_settings } from '../../../../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../popup.js';
import { LOG_PREFIX, NARRATOR_RULES_PROMPT, SILLYNPC_THEMES, PORTRAIT_SHAPES, debugLog, setDebugLogging } from '../../core/constants.js';
import { buildLoreExcerpt, resolvePortraitShape, getLastLoreConnection, scanFolderForCharacterImages, persistGeneratedImage, findOrphanedImages, deleteImageFiles } from '../../api/api.js';
import { getSecretLabelById } from '../../../../../../secrets.js';
import { getRequestHeaders } from '../../../../../../../script.js';
import { getContext } from '../../../../../../extensions.js';
import { buildConnectionProfilePicker } from './ui-connection-profiles.js';
import { clearRuns } from '../../characters/default-portraits.js';
import { triggerReprocess } from '../../chat/chat.js';
import { renderDefaultView } from './ui-settings-defaults.js';

/**
 * Display labels for the shipped themes. Built from SILLYNPC_THEMES so the
 * dropdown can never drift out of sync with the themes that actually exist.
 */
const THEME_LABELS = {
    'terminal': 'Terminal (Dark - Mono)',
    'cyberpunk': 'Cyberpunk (Neon - Mono)',
    'monochrome': 'Monochrome (Light)',
    'modern-dark': 'Modern Dark',
    'fantasy-hud': 'Fantasy HUD (Dark - Serif)',
    'tabletop-parchment': 'Tabletop Parchment (Light - Serif)',
    'analog-horror': 'Analog Horror (Dark - Mono)',
    'rosewater': 'Rosewater (Light - Serif)',
};

const THEME_OPTIONS = SILLYNPC_THEMES.map(id => ({ value: id, label: THEME_LABELS[id] || id }));

/**
 * How the chat and the menu look.
 *
 * Was "UI Style", which held the styling but not the four controls that decide whether
 * anything is coloured, whether names are replaced by portraits, or how a portrait is
 * scaled - those were in a tab called Settings, along with the prompts, the popup size and
 * the debug switch. Everything visual is here now.
 */
export function renderAppearanceView(view, onReprocessMessages, updateExtensionTheme) {
    if (!view) return;

    view.replaceChildren();
    const reprocess = () => onReprocessMessages();
    const rerender = () => renderAppearanceView(view, onReprocessMessages, updateExtensionTheme);

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'Chat & Menu Styling';
    view.appendChild(title);

    view.append(buildSettingSelect({
        key: 'menuStyle',
        label: 'Unified Theme Style',
        help: 'Unified appearance style that applies to extension menus, sheets, popups, and in-chat status tracker boxes.',
        options: [{ value: 'default', label: 'Seamless Native' }, ...THEME_OPTIONS],
        onChange: () => { updateAllExtensionThemes(); reprocess(); },
    }));
    view.append(buildSettingSlider({
        key: 'menuFontScale',
        label: 'Menu Text Size',
        min: 0.8, max: 1.5, step: 0.05, suffix: 'x',
        help: 'Text in the menus, the character pages and the player sheet, against what '
            + 'the chosen theme sets - so a theme with larger type stays larger.',
        onChange: () => updateAllExtensionThemes(),
    }));
    view.append(buildSettingSlider({
        key: 'trackerFontScale',
        label: 'Tracker Text Size',
        min: 0.8, max: 1.5, step: 0.05, suffix: 'x',
        help: 'Text in the status box in the chat. Separate from the menus because the box '
            + 'sits in the middle of the story and competes with the prose around it - '
            + 'wanting it smaller there is not wanting the settings smaller too.',
        onChange: reprocess,
    }));
    view.append(buildSettingSelect({ key: 'dividerStyle', label: 'Speech Block Dividers', options: [{value:'subtle',label:'Subtle Fade'},{value:'bold',label:'Solid Accent'},{value:'dashed',label:'Dashed Line'},{value:'none',label:'No Dividers'}], onChange: reprocess }));
    view.append(buildSettingSlider({
        key: 'speechPadY',
        label: 'Speech Block Spacing',
        min: 0, max: 30, step: 1, suffix: 'px',
        help: 'Space above and below each character block. The width of the coloured band '
            + 'is fixed; only its height changes here.',
        onChange: () => { applySpeechPadding(); reprocess(); },
    }));

    const colourHeading = document.createElement('h3');
    colourHeading.className = 'sillynpc-section-title';
    colourHeading.style.marginTop = '20px';
    colourHeading.textContent = 'Colour';
    view.append(colourHeading);

    view.append(buildSettingToggle({
        key: 'applyColors',
        label: 'Enable Colored Chat Blocks',
        help: 'The master switch for colour in the chat: with it off nothing is tinted, and '
            + 'any colour the model wrote into its own reply is left showing through. On, a '
            + 'speaker\'s dialogue carries their colour in the style set below.',
        onChange: rerender,
    }));
    // Only while there is colouring for them to affect. Both decide how colour is applied
    // rather than whether it happens, so with the switch above off they do nothing at all -
    // and a live-looking control that does nothing is worse than one that is absent.
    if (getSettings().applyColors) {
        view.append(buildSettingSelect({ key: 'colorStyle', label: 'Character Coloring Logic', options: [{value:'text',label:'Text Only'},{value:'background',label:'Soft Background'},{value:'border',label:'Left Border Accent'},{value:'gradient',label:'Subtle Gradient'},{value:'all',label:'Full Highlight (Strong)'}], onChange: reprocess }));
        view.append(buildSettingToggle({
            key: 'autoColorUnknownSpeakers',
            label: 'Colour Speakers Without A Card',
            help: 'A card\'s own colour always wins, so this is only about everybody else. '
                + 'On, anyone who speaks gets a shade derived from their name - the same '
                + 'name always the same shade. Off, a colour is what marks the characters '
                + 'you have made a card for.',
            onChange: reprocess,
        }));
    }

    const portraitHeading = document.createElement('h3');
    portraitHeading.className = 'sillynpc-section-title';
    portraitHeading.style.marginTop = '20px';
    portraitHeading.textContent = 'Portraits In The Chat';
    view.append(portraitHeading);

    view.append(buildSettingSelect({ key: 'avatarShape', label: 'Chat Avatar Shape', options: [{value:'square',label:'Sharp Square'},{value:'rounded',label:'Rounded Corners'},{value:'circle',label:'Perfect Circle'}], onChange: reprocess }));
    view.append(buildSettingSelect({ key: 'avatarSize', label: 'Chat Avatar Size', options: [{value:'small',label:'Small (44px)'},{value:'medium',label:'Medium (64px)'},{value:'large',label:'Large (96px)'},{value:'extra',label:'Extra Large (132px)'}], onChange: reprocess }));
    view.append(buildSettingSelect({ key: 'defaultImageFit', label: 'Avatar Image Scaling', options: [{value:'contain',label:'Fit within frame (Contain)'},{value:'cover',label:'Fill frame completely (Cover)'}], onChange: reprocess }));
    view.append(buildSettingSelect({
        key: 'portraitFraming',
        label: 'Portrait Framing',
        options: [
            { value: 'top', label: 'Keep the top (faces)' },
            { value: 'center', label: 'Keep the middle' },
            { value: 'bottom', label: 'Keep the bottom' },
        ],
        help: 'The floating HUD and the tracker box show portraits in circles, so a tall '
            + 'image loses two of its edges. Keeping the top shows the head in almost any '
            + 'portrait; change it if your pictures are framed differently.',
        onChange: () => { applyPortraitFraming(); reprocess(); },
    }));
    view.append(buildSettingToggle({
        key: 'hideSpeakerNames',
        label: 'Hide Default Speaker Names',
        help: 'Hides the name and colon when a character has a card and portrait. Speakers '
            + 'without cards keep their names so they remain distinguishable.',
        onChange: reprocess,
    }));

    renderDefaultView(view, rerender);
}

/**
 * What the model is asked to write, and how what it writes is read back.
 *
 * A tab of its own because these three - the dialogue format, the narrator rules and the
 * ban list - are one job done three ways, and they were scattered across two tabs, one of
 * which was called Settings and held the popup size as well.
 *
 * The reading half belongs with them rather than with the styling: "Not Speakers" and
 * lenient matching decide what counts as somebody talking, which is the same question the
 * dialogue format asks the model to make easy.
 */
