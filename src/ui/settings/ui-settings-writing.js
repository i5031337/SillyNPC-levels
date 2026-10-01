import { getSettings } from '../../core/settings.js';
import { promptListAvailable } from '../../prompts/prompt-slot.js';
import { applyDialogueFormatPrompt } from '../../prompts/dialogue-format.js';
import { buildSettingToggle, buildSettingTextArea, buildSettingNumber } from '../shared/ui-shared.js';
import { renderBanList } from '../shared/ui-banlist.js';

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
    intro.textContent = 'Ask for consistent dialogue, avoid repeated phrases, and choose how speakers are recognized.';
    view.appendChild(intro);

    const formatHeading = document.createElement('h4');
    formatHeading.className = 'sillynpc-subsection-title';
    formatHeading.textContent = 'Dialogue Formatting';
    view.append(formatHeading);

    view.append(buildSettingToggle({
        key: 'dialogueFormatEnabled',
        label: 'Ask The Model To Format Dialogue',
        help: 'Asks for each spoken line as Speaker: "dialogue". This is the format used '
            + 'for avatars, speech blocks and colours, including speakers without cards.',
        onChange: rerender,
    }));
    if (getSettings().dialogueFormatEnabled) {
        if (promptListAvailable()) {
            view.append(buildSettingToggle({
                key: 'dialogueFormatInPromptList',
                label: "Manage In SillyTavern's Prompt List",
                help: "Puts the dialogue format into SillyTavern's own prompt list, under AI Response Configuration, where it can be dragged among the system prompts, given another depth, or switched off beside everything else. It goes in as In-Chat at depth 0, which is where it already sits, so switching this on moves nothing until you move it. The entry is kept in your chat completion preset: it is exported with that preset, and loading a different one drops it until SillyNPC puts it back. The extension supplies the built-in wording; the list controls where it goes and whether it is sent. Chat Completion only: there is no such list on Text Completion.",
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
            help: 'How far back from the newest message the built-in format is inserted. 0 '
                + 'puts it after the newest one, so it is the last thing the model reads '
                + 'before answering - which is where a layout rule holds best, and why it '
                + 'is the default. Raise it only if it crowds something you would rather '
                + 'have last.',
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
        help: 'Labels in a Name: "dialogue" line that are not people. One per line or '
            + 'separated by commas. Everything you '
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
