import { clearRuns } from '../../characters/default-portraits.js';
import { triggerReprocess } from '../../chat/chat.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { pickAndProcessImages, resolveImageFolder, describeSaveDestination } from '../../core/utils.js';
import { promptListAvailable } from '../../prompts/prompt-slot.js';
import { applyDialogueFormatPrompt } from '../../prompts/dialogue-format.js';
import { applyNarratorRulesPrompt } from '../../prompts/narrator-rules.js';
import { buildSettingSelect, buildSettingToggle, buildSettingTextArea, buildSettingSlider, buildSettingNumber, updateAllExtensionThemes, applyPortraitFraming, applySpeechPadding } from '../shared/ui-shared.js';
import { buildPromptEditor, buildPromptBudget } from '../shared/ui-prompts.js';
import { renderBanList } from '../shared/ui-banlist.js';
import { promptById } from '../../prompts/prompts.js';
import { world_names } from '../../../../../../world-info.js';
import { extension_settings } from '../../../../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../../popup.js';
import { LOG_PREFIX, NARRATOR_RULES_PROMPT, SILLYNPC_THEMES, PORTRAIT_SHAPES, debugLog, setDebugLogging } from '../../core/constants.js';
import { buildLoreExcerpt, resolvePortraitShape, getLastLoreConnection, scanFolderForCharacterImages, persistGeneratedImage, findOrphanedImages, deleteImageFiles } from '../../api/api.js';
import { getSecretLabelById } from '../../../../../../secrets.js';
import { getRequestHeaders } from '../../../../../../../script.js';
import { getContext } from '../../../../../../extensions.js';
import { buildConnectionProfilePicker } from './ui-connection-profiles.js';

export function renderWritingRulesView(view, onReprocessMessages) {
    if (!view) return;

    view.replaceChildren();
    const reprocess = () => onReprocessMessages();
    const rerender = () => renderWritingRulesView(view, onReprocessMessages);

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.textContent = 'What The Model Is Asked To Write';
    view.appendChild(title);

    const intro = document.createElement('p');
    intro.className = 'notes sillynpc-tab-intro';
    intro.textContent = 'Everything here is sent with your messages, and each is placed '
        + 'rather than merely worded: where an instruction sits in the prompt decides '
        + 'whether it holds. Only the dialogue format is on to begin with, because the '
        + 'rest of the extension reads what it asks for.';
    view.appendChild(intro);

    const formatHeading = document.createElement('h4');
    formatHeading.className = 'sillynpc-subsection-title';
    formatHeading.textContent = 'Dialogue Formatting';
    view.append(formatHeading);

    view.append(buildSettingToggle({
        key: 'dialogueFormatEnabled',
        label: 'Ask The Model To Format Dialogue',
        help: 'Sends the Dialogue Format prompt with every message, asking for a speaker '
            + 'line - a name in bold followed by a colon - which is what avatars, speech '
            + 'blocks and colours all read. Without it, whether your chat is decorated '
            + 'depends on your persona or preset happening to ask for the same thing, and '
            + 'switching either one silently stops all of it.',
        onChange: rerender,
    }));
    if (getSettings().dialogueFormatEnabled) {
        view.append(buildPromptEditor(promptById('dialogueFormat')));
        if (promptListAvailable()) {
            view.append(buildSettingToggle({
                key: 'dialogueFormatInPromptList',
                label: "Manage In SillyTavern's Prompt List",
                help: "Puts the dialogue format into SillyTavern's own prompt list, under AI Response Configuration, where it can be dragged among the system prompts, given another depth, or switched off beside everything else. It goes in as In-Chat at depth 0, which is where it already sits, so switching this on moves nothing until you move it. The entry is kept in your chat completion preset: it is exported with that preset, and loading a different one drops it until SillyNPC puts it back. The text stays here - the list owns only where it goes and whether it is sent. Chat Completion only: there is no such list on Text Completion.",
                onChange: () => {
                    // At once rather than at the next message: the list entry is
                    // what makes the block appear there at all, and a setting whose
                    // effect waits for a send reads as a setting that did nothing.
                    applyDialogueFormatPrompt();
                    rerender();
                },
            }));
        }
        // Hidden rather than disabled when the list owns the block. There is no extension
        // injection left to give a depth to then - the entry in the list is the injection,
        // and its own depth field is the one that means anything.
        if (!getSettings().dialogueFormatInPromptList) view.append(buildSettingNumber({
            key: 'dialogueFormatDepth',
            advanced: true,
            label: 'Format Reminder Depth',
            suffix: 'messages back',
            help: 'How far back from the newest message the prompt above is inserted. 0 '
                + 'puts it after the newest one, so it is the last thing the model reads '
                + 'before answering - which is where a layout rule holds best, and why it '
                + 'is the default. Raise it only if it crowds something you would rather '
                + 'have last.',
        }));
    }

    const narratorHeading = document.createElement('h4');
    narratorHeading.className = 'sillynpc-subsection-title';
    narratorHeading.textContent = 'Narrator Rules';
    view.append(narratorHeading);

    view.append(buildSettingToggle({
        key: 'narratorRulesEnabled',
        label: 'Send Narrator Rules Late In The Prompt',
        help: 'For the rules a narrator keeps breaking: speaking or acting for you, '
            + 'recapping what just happened, wrapping the scene up, summarising instead of '
            + 'writing it. Written into a card those sit at the top of the prompt with the '
            + 'whole chat between them and the moment they apply, which is why rewording '
            + 'one so often changes nothing - where it sits was the problem, not how it '
            + 'was phrased. Switching this on fills the box with a working set to edit; '
            + 'emptying the box sends nothing.',
        onChange: () => {
            // Filled on the way on, not shipped as a default. Nothing is ever sent while
            // the feature is off, so this cannot put words in a prompt nobody asked for -
            // and a blank field beside "write something here" is not guidance.
            const settings = getSettings();
            if (settings.narratorRulesEnabled
                && !String(settings.narratorRulesPrompt ?? '').trim()) {
                settings.narratorRulesPrompt = NARRATOR_RULES_PROMPT;
                saveSettings();
            }
            rerender();
        },
    }));
    if (getSettings().narratorRulesEnabled) {
        view.append(buildPromptEditor(promptById('narratorRules')));
        if (promptListAvailable()) {
            view.append(buildSettingToggle({
                key: 'narratorRulesInPromptList',
                label: "Manage In SillyTavern's Prompt List",
                help: "Puts the narrator rules into SillyTavern's own prompt list, under AI Response Configuration, where it can be dragged among the system prompts, given another depth, or switched off beside everything else. It goes in as In-Chat at depth 0, which is where it already sits, so switching this on moves nothing until you move it. The entry is kept in your chat completion preset: it is exported with that preset, and loading a different one drops it until SillyNPC puts it back. The text stays here - the list owns only where it goes and whether it is sent. Chat Completion only: there is no such list on Text Completion.",
                onChange: () => {
                    // At once rather than at the next message: the list entry is
                    // what makes the block appear there at all, and a setting whose
                    // effect waits for a send reads as a setting that did nothing.
                    applyNarratorRulesPrompt();
                    rerender();
                },
            }));
        }
        if (!getSettings().narratorRulesInPromptList) view.append(buildSettingNumber({
            key: 'narratorRulesDepth',
            advanced: true,
            label: 'Narrator Rules Depth',
            suffix: 'messages back',
            help: 'How far back from the newest message the rules are inserted. 0 puts '
                + 'them after the newest one, last before the model answers, which is '
                + 'where an instruction holds best. Raise it if it crowds the dialogue '
                + 'format, which wants the same place.',
        }));
    }

    const banHeading = document.createElement('h4');
    banHeading.className = 'sillynpc-subsection-title';
    banHeading.textContent = 'Ban List';
    view.append(banHeading);

    view.append(buildSettingToggle({
        key: 'banListEnabled',
        label: 'Stop The Model Repeating Itself',
        help: 'Phrases you have banned are sent to the sampler where your backend takes '
            + 'them, which means the model cannot write them - not that it is asked not '
            + 'to. On an API that has no such thing they are asked for in the prompt '
            + 'instead, and the panel says which of the two you are getting.',
        onChange: rerender,
    }));
    if (getSettings().banListEnabled) {
        const banPanel = document.createElement('div');
        view.append(banPanel);
        renderBanList(banPanel);

        view.append(buildSettingNumber({
            key: 'banScanDepth',
            advanced: true,
            label: 'Scan Depth',
            suffix: 'replies',
            help: 'How many of the model\'s own replies the scan reads. Your own messages '
                + 'are skipped - your habits are not what this is for. 0 reads the whole '
                + 'chat, which costs more and finds older habits.',
        }));
    }

    const readingHeading = document.createElement('h3');
    readingHeading.className = 'sillynpc-section-title';
    readingHeading.style.marginTop = '24px';
    readingHeading.textContent = 'How Its Writing Is Read';
    view.append(readingHeading);

    const readingNote = document.createElement('p');
    readingNote.className = 'notes sillynpc-tab-intro';
    readingNote.textContent = 'The other side of the same question: which of the words in a '
        + 'reply are somebody speaking.';
    view.append(readingNote);

    view.append(buildSettingTextArea({
        key: 'speakerIgnoreList',
        label: 'Not Speakers',
        help: 'Words the narrator writes in bold before a colon that are not people - DC, '
            + 'Cost, Damage, Roll. One per line or separated by commas. Everything you '
            + 'named in System Builder is already excluded, so stats and collections need '
            + 'no entry here. A character who has a card is never ignored.',
        onChange: reprocess,
    }));
    view.append(buildSettingToggle({
        key: 'caseInsensitive',
        label: 'Lenient Name Matching',
        help: 'Matches character names regardless of uppercase/lowercase letters.',
        onChange: reprocess,
    }));
}

/**
 * The extension itself: whether it runs, how big its menu is, and how to see what it does.
 *
 * What is left of a tab called Settings once everything that belonged to a subject went to
 * that subject's tab. These four genuinely belong to no feature.
 *
 * @param {HTMLElement} view
 * @param {{ applyPopupSize: () => void, onExport: () => void, onImport: () => void }} handlers
 */
