import { buildSettingToggle, buildSettingSlider, buildSettingSelect, buildSettingNumber } from '../shared/ui-shared.js';
import { buildPlacementPicker, buildHistoryNoteFields } from './ui-tracker-history.js';
import { buildConnectionProfilePicker } from '../settings/ui-connection-profiles.js';

export function renderTrackerDisplayAndReading({ container, settings, onApply, onDisplay, onChange, section }) {
    /* -- Display ----------------------------------------------------------- */

    container.append(buildSettingToggle({
        key: 'statusTracker.enabled',
        label: 'Enable Status Tracker',
        help: 'Tracks stats, inventories and who is in the scene, and shows them under '
            + 'your messages.',
        onChange
    }));

    // One question, not two: both of these only ever answered "where does the box go".
    container.append(buildPlacementPicker(settings, onDisplay));

    container.append(buildSettingToggle({
        key: 'statusTracker.showGlobalStats',
        label: 'Show World Stats',
        help: 'Location, time and the rest of your world-level stats.',
        onChange: onDisplay
    }));

    container.append(buildSettingToggle({
        key: 'statusTracker.showPlayerStats',
        label: 'Show Player Stats',
        help: 'Shows the player’s stats and collections in the tracker. Hide World, Player '
            + 'and NPC Stats to hide the tracker bar while tracking continues in the background.',
        onChange: onDisplay
    }));

    container.append(buildSettingToggle({
        key: 'statusTracker.showNpcStats',
        label: 'Show NPC Stats',
        help: 'Shows NPC rows, including their stats, collections and portraits, in the tracker.',
        onChange: onDisplay
    }));

    container.append(buildSettingToggle({
        key: 'statusTracker.showRawTrackerOutput',
        label: 'Show Raw Tracker Output',
        help: 'Shows the reader’s progress and output dropdown beneath messages. '
            + 'Hiding it leaves tracking and change review active.',
        onChange: onDisplay
    }));

    container.append(buildSettingToggle({
        key: 'statusTracker.showNpcPortraits',
        label: 'Show Portraits',
        help: 'Each character\'s card image beside their name. Put {{portrait}} in your '
            + 'template to place it yourself.',
        onChange: onDisplay
    }));

    container.append(buildSettingToggle({
        key: 'statusTracker.characterColumns',
        label: 'Characters Side By Side',
        help: 'Lays the characters out in equal columns, as many as fit - so a wide chat or '
            + 'the visual novel stage uses its width instead of leaving most of every line '
            + 'empty. A character with a lot to show gets a wider column, down to one. Needs '
            + 'the character rows of the default template.',
        onChange: onDisplay
    }));

    container.append(buildSettingSlider({
        key: 'statusTracker.summaryThreshold',
        label: 'Items Shown Per Collection',
        min: 1,
        max: 20,
        step: 1,
        help: 'How many items the status box lists before summarising the rest as '
            + '"+N more". Display only - the model is always told the whole collection, '
            + 'however this is set.',
        onChange: onDisplay
    }));

    /* -- How stats are read ------------------------------------------------ */

    section('How Stats Are Read');

    container.append(buildSettingSelect({
        key: 'statusTracker.extractionMode',
        label: 'Method',
        options: [
            { value: 'extract', label: 'A separate pass after each message' },
            { value: 'manual', label: 'Manual — run from the send bar' },
            { value: 'inline', label: 'Ask for a status block in the reply' },
        ],
        help: 'A separate pass keeps bookkeeping out of the story, so a character card '
            + 'that forbids numbers no longer fights the tracker. It costs one extra '
            + 'request per message. Manual runs only when you click Read latest reply '
            + 'on the send bar, using the latest reply and the configured lead-up.',
        onChange
    }));

    if (settings.extractionMode === 'extract' || settings.extractionMode === 'manual') {
        container.appendChild(buildConnectionProfilePicker(onApply));
        container.append(buildSettingToggle({
            key: 'statusTracker.autoGenerateNpcProfiles',
            label: 'Generate Profiles For New NPCs',
            help: 'When the reader identifies an NPC without a character card, creates a '
                + 'card in this chat and writes its configured profile fields to lore. '
                + 'Uses the lore generation connection and context settings, with one extra '
                + 'request per new NPC. Unsupported details may stay blank. Existing cards '
                + 'are left as they are. Draw Portrait Automatically under Generation → Image Generation controls image requests.',
            onChange: onApply,
        }));
    }

    container.append(buildSettingSlider({
        key: 'statusTracker.extractionContextMessages',
        advanced: true,
        label: 'Messages Of Lead-Up',
        min: 0,
        max: 6,
        step: 1,
        help: 'How many earlier messages the reader sees. Needed when a cost is announced '
            + 'in one message and only paid once a roll succeeds two messages later.',
        onChange: onApply
    }));

    container.append(buildSettingSlider({
        key: 'statusTracker.extractionMaxTokens',
        advanced: true,
        label: 'Extraction Reply Budget',
        min: 300,
        max: 4000,
        step: 100,
        help: 'Raise this if updates come back truncated while tracking many stats.',
        onChange: onApply
    }));

    container.append(buildSettingNumber({
        key: 'statusTracker.extractionTemperature',
        label: 'Reader Temperature',
        step: 0.05,
        max: 2,
        allowEmpty: true,
        placeholder: 'the model\'s own',
        help: 'How steady the reader is: 0 reads the same message the same way every time, '
            + 'higher invents more. Around 0.2 suits a job whose answer is facts and JSON. '
            + 'Empty sends none, leaving it to the model - usually 1.0, which is loose for '
            + 'this. Sent only when the tracker has its own connection profile; through your '
            + 'main API, that API\'s own settings decide. Nothing else from your story preset '
            + 'is ever sent with an extraction.',
        onChange: onApply,
    }));

    container.append(buildSettingToggle({
        key: 'statusTracker.historyNotes',
        label: 'World State On Each Message',
        help: 'Puts a line at the top of every earlier message in the story prompt saying what '
            + 'the world held at that message - the snapshot the tracker already saves. Without '
            + 'it the model reads the whole history with no time and no place on any of it, so '
            + '"what we did two days ago" is unanswerable unless somebody said the date out '
            + 'loud. It costs what it carries: on a sixty-message context, all four of a typical '
            + 'setup\'s world fields are about 2,400 tokens, time and place alone about 600. '
            + 'Your chat file is untouched - the notes are added to the copy sent to the model.',
        onChange,
    }));

    if (settings.historyNotes) container.append(buildHistoryNoteFields(settings, onApply));

    container.append(buildSettingToggle({
        key: 'statusTracker.extractionReasons',
        label: 'Ask Why A Value Changed',
        help: 'The reader explains each change in a clause, shown on the review rows - so '
            + 'a stat that moves for no reason you can see is told apart from one that '
            + 'moved for a good one. It is also asked not to change a value it cannot '
            + 'point at something for, which may cut the invented ones. Costs a few tokens '
            + 'per change; turn off if your extraction model struggles to return prose and '
            + 'clean JSON at once.',
        onChange: onApply
    }));

    container.append(buildSettingToggle({
        key: 'statusTracker.extractionUseSchema',
        advanced: true,
        label: 'Force JSON Schema',
        help: 'Sends a strict schema with the request. Leave off unless you know your '
            + 'backend handles it: some models answer with an empty object rather than '
            + 'refuse a schema they dislike, which loses the update silently.',
        onChange: onApply
    }));

}
