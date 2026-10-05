import { progressionFields } from '../progression-fields.js';
import { npcTemplateFor } from '../../core/npc-templates.js';
import { charactersMentionedIn } from '../../chat/chat.js';
import { charactersFromActivatedLore } from '../../lore/activated-lore.js';
import { liveFactsFor } from '../../api/api.js';
import { summariseCollections, profileBlock } from './status-extractor-prompt-state.js';
import { isReaderStat } from '../stat-update-policy.js';

/**
 * Cards for characters the message names who are not in the scene.
 *
 * A character written in by the narrator - because their lorebook entry fired, or simply
 * because the story mentions them - is restored from their card when presence is
 * reconciled. But that happens after this request was built, so the reader saw a state
 * without them and reported them as new with nothing to their name.
 *
 * Kept separate from the current scene cast. The reader may return an evidenced
 * update with offstage:true without adding the known character to scene presence.
 *
 * @param {object} state
 * @param {string} messageText
 * @returns {string}
 */
export function describeAbsentButNamed(state, messageText, trackerSettings) {
    const present = new Set((state.characters || []).map(c => String(c.name).toLowerCase()));
    const candidates = [...charactersMentionedIn(messageText), ...charactersFromActivatedLore()];

    const seen = new Set();
    const records = [];
    for (const char of candidates) {
        const key = String(char.name || '').toLowerCase();
        if (!key || present.has(key) || seen.has(key)) continue;
        seen.add(key);

        // Offstage facts come from the card, including its held collections.
        const { stats, collections } = liveFactsFor(char);
        const progression = progressionFields(trackerSettings, { actor: char });
        const visibleStats = Object.fromEntries(Object.entries(stats || {}).filter(([name]) =>
            !(trackerSettings.npcStats || []).some(def => !isReaderStat(def)
                && def.name?.toLowerCase() === name.toLowerCase()
                && !(progression.enabled && [progression.xpName, progression.levelName].includes(def.name)))));
        const listed = summariseCollections({ ...char, collections }, 'npc', trackerSettings);
        const profile = profileBlock(char);

        // Nothing at all to say is not worth a line. A card with only a profile still is:
        // that is who they are, and it is the half the reader most often lacks.
        const hasStats = Object.keys(visibleStats).length > 0;
        const hasItems = Object.values(listed || {}).some(items => items.length);
        if (!hasStats && !hasItems && !profile.profile) continue;

        records.push({
            name: char.name,
            offstage: true,
            npcTemplateId: npcTemplateFor(char)?.id || '(unassigned)',
            ...(hasStats ? { stats: visibleStats } : {}),
            ...(hasItems ? { collections: listed } : {}),
            ...profile,
        });
    }

    return records.length ? JSON.stringify(records) : '';
}
