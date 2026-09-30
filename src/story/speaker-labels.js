import { getSettings } from '../core/settings.js';

/**
 * Which labels are not people.
 *
 * Lived in chat.js, where only the chat decorator could reach it - so a name you had
 * excluded was still admitted to the tracker's cast by the extractor, which reports
 * whoever it thinks is present without consulting the setting at all. status-logic.js
 * needs it now and cannot import chat.js, because chat.js imports status-logic.js.
 *
 * Nothing here reaches for the DOM or the chat, so it can be imported from anywhere.
 */

/** Configured field names and user exclusions that cannot be unknown speakers. */
export function getIgnoredSpeakerLabels() {
    const settings = getSettings();
    const tracker = settings.statusTracker || {};
    const labels = new Set();

    const add = (raw) => {
        const name = normaliseSpeakerLabel(raw);
        if (name) labels.add(name);
    };

    for (const key of ['globalStats', 'playerStats', 'npcStats']) {
        for (const stat of tracker[key] || []) add(stat?.name);
    }
    for (const collection of tracker.collections || []) {
        add(collection?.id);
        add(collection?.name);
        for (const field of collection?.fields || []) add(field?.name);
    }
    for (const word of String(settings.speakerIgnoreList || '').split(/[\n,]/)) add(word);

    return labels;
}

/** Trims a label down to what it would be called, so "Attack Difficulty: " matches "Attack Difficulty". */
export function normaliseSpeakerLabel(raw) {
    return String(raw ?? '').trim().replace(/[:：\s]+$/, '').trim().toLowerCase();
}
