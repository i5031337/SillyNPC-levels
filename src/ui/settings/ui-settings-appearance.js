import { renderHudView } from '../hud/ui-hud-settings.js';
import { getSettings } from '../../core/settings.js';
import { buildSettingSelect, buildSettingToggle, buildSettingSlider, updateAllExtensionThemes, applyPortraitFraming, applySpeechPadding } from '../shared/ui-shared.js';
import { SILLYNPC_THEMES } from '../../core/constants.js';
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

function customize(label, opened) {
    const details = document.createElement('details');
    details.className = 'sillynpc-customize';
    details.open = opened.has(label);
    const summary = document.createElement('summary');
    summary.textContent = label;
    details.append(summary);
    return details;
}

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

    const opened = new Set([...view.querySelectorAll('details[open] > summary')]
        .map(summary => summary.textContent));
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
    const chatDetails = customize('Customize chat blocks', opened);
    chatDetails.append(buildSettingSelect({ key: 'dividerStyle', label: 'Speech Block Dividers', options: [{value:'subtle',label:'Subtle Fade'},{value:'bold',label:'Solid Accent'},{value:'dashed',label:'Dashed Line'},{value:'none',label:'No Dividers'}], onChange: reprocess }));
    chatDetails.append(buildSettingSlider({
        key: 'speechPadY',
        label: 'Speech Block Spacing',
        min: 0, max: 30, step: 1, suffix: 'px',
        help: 'Space above and below each character block. The width of the coloured band '
            + 'is fixed; only its height changes here.',
        onChange: () => { applySpeechPadding(); reprocess(); },
    }));
    view.append(chatDetails);

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

    view.append(buildSettingSelect({ key: 'avatarSize', label: 'Chat Avatar Size', options: [{value:'small',label:'Small (44px)'},{value:'medium',label:'Medium (64px)'},{value:'large',label:'Large (96px)'},{value:'extra',label:'Extra Large (132px)'}], onChange: reprocess }));
    const portraitDetails = customize('Customize portraits', opened);
    portraitDetails.append(buildSettingSelect({ key: 'avatarShape', label: 'Chat Avatar Shape', options: [{value:'square',label:'Sharp Square'},{value:'rounded',label:'Rounded Corners'},{value:'circle',label:'Perfect Circle'}], onChange: reprocess }));
    portraitDetails.append(buildSettingSelect({ key: 'defaultImageFit', label: 'Avatar Image Scaling', options: [{value:'contain',label:'Fit within frame (Contain)'},{value:'cover',label:'Fill frame completely (Cover)'}], onChange: reprocess }));
    portraitDetails.append(buildSettingSelect({
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
    portraitDetails.append(buildSettingToggle({
        key: 'hideSpeakerNames',
        label: 'Hide Default Speaker Names',
        help: 'Hides the name and colon when a character has a card and portrait. Speakers '
            + 'without cards keep their names so they remain distinguishable.',
        onChange: reprocess,
    }));
    view.append(portraitDetails);

    const fallbackDetails = customize('Fallback portraits', opened);
    renderDefaultView(fallbackDetails, rerender);
    view.append(fallbackDetails);

    const addedView = document.createElement('div');
    addedView.id = 'sillynpc-hud-view';
    view.append(addedView);
    renderHudView(addedView);
}
