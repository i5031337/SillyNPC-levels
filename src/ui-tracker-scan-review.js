import { buildSettingToggle, buildSettingSlider, buildSettingSelect } from './ui-shared.js';
import { buildConnectionProfilePicker } from './ui-connection-profiles.js';

export function renderTrackerScanAndReview({ container, settings, onApply, onChange, section }) {
    /* -- History scan ------------------------------------------------------ */

    section('History Scan');

    container.append(buildSettingToggle({
        key: 'statusTracker.scanButtonEnabled',
        label: 'Scan Button On The Send Bar',
        help: 'Reads the story so far and proposes what each character should be carrying '
            + 'and know. Useful when inventories have drifted, or when adopting the '
            + 'tracker part-way through a story.',
        onChange
    }));

    if (settings.scanButtonEnabled !== false) {
        container.append(buildSettingSelect({
            key: 'statusTracker.scanDepth',
            label: 'History To Read',
            options: [
                { value: 50, label: 'Recent - the last 50 messages' },
                { value: 200, label: 'Long - the last 200 messages' },
                { value: 0, label: 'Everything - the whole chat' },
            ],
            help: 'A story too big for one request is read in several passes rather than '
                + 'being cut short. The scan tells you how many messages and how many '
                + 'requests before it spends anything.',
            onChange: onApply
        }));

        container.appendChild(buildConnectionProfilePicker(onApply, {
            key: 'scanProfileId',
            labelText: 'Scan Connection',
            fallbackLabel: 'Same as the extraction connection',
            noteText: 'Reading a whole history is a harder job than a single message. A '
                + 'small model that handles updates well can still return nonsense here, '
                + 'and scans are rare enough to afford a better one.',
            unavailableText: 'Connection Manager is not available, so a scan uses the same '
                + 'connection as the extraction.',
        }));
    }

    container.append(buildSettingSlider({
        key: 'statusTracker.scanMaxTokens',
        advanced: true,
        label: 'Scan Reply Budget',
        min: 1000,
        max: 8000,
        step: 500,
        help: 'A scan lists whole inventories for several characters at once, so it needs '
            + 'more room than a single stat change.',
        onChange: onApply
    }));

    container.append(buildSettingSlider({
        key: 'statusTracker.scanCharBudget',
        advanced: true,
        label: 'Transcript Per Pass',
        min: 10000,
        max: 200000,
        step: 10000,
        help: 'How much text one pass carries. Smaller means more passes over the same '
            + 'story, not less of it read.',
        onChange: onApply
    }));

    container.append(buildSettingSlider({
        key: 'statusTracker.scanMaxChunks',
        advanced: true,
        label: 'Pass Limit',
        min: 0,
        max: 30,
        step: 1,
        help: '0 means as many passes as the history needs. Set a number to cap what one '
            + 'scan may cost, at the price of leaving older messages unread.',
        onChange: onApply
    }));

    /* -- Reviewing changes ------------------------------------------------- */

    section('Reviewing Changes');

    container.append(buildSettingSelect({
        key: 'statusTracker.reviewMode',
        label: 'Ask Before Applying',
        options: [
            { value: 'risky', label: 'Risky changes only' },
            { value: 'all', label: 'Every change' },
            { value: 'off', label: 'Nothing - apply everything' },
        ],
        help: 'An update replaces an inventory wholesale, so an item the AI forgets to '
            + 'mention would vanish. Gained and lost items, and implausible jumps, wait '
            + 'for you in a panel under the message instead. Ordinary movement still '
            + 'applies on its own, and Undo covers the rest.',
        onChange
    }));

    container.append(buildSettingSelect({
        key: 'statusTracker.maxChangePolicy',
        label: 'When A Maximum Moves',
        options: [
            { value: 'free', label: 'Apply it - level-ups vary by system' },
            { value: 'review-decreases', label: 'Ask before a maximum drops' },
            { value: 'review-all', label: 'Ask every time' },
        ],
        help: 'A ceiling rising is usually a level-up. A ceiling falling is almost never '
            + 'intended. Either way it is listed in the review panel, so it stays visible '
            + 'and undoable.',
        onChange: onApply
    }));

    container.append(buildSettingSlider({
        key: 'statusTracker.reviewSwingThreshold',
        advanced: true,
        label: 'Implausible Jump',
        min: 0.1,
        max: 1.0,
        step: 0.05,
        help: 'A value moving by more than this share of its range in one message waits '
            + 'for review. 1.0 turns the check off.',
        onChange: onApply
    }));

}
