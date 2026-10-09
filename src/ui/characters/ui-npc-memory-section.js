import { LOG_PREFIX } from '../../core/constants.js';
import { getSettings } from '../../core/settings.js';
import { profileFieldsForCard } from '../../core/profile-fields.js';
import { syncProfileToLore } from '../../lore/lore-sync.js';
import { loadStateFromMetadata, saveStateToMetadata } from '../../tracker/status-logic.js';
import { readNpcMemories, writeNpcMemories } from '../../tracker/npc-memories.js';
import { renderMemorySection } from './ui-memories.js';

/** The same chat-owned memory editor on the Cast Profile and Edit pages. */
export function renderNpcMemorySection(char, container) {
    return renderMemorySection(container, {
        read: () => readNpcMemories(loadStateFromMetadata(), char),
        write: store => {
            const state = loadStateFromMetadata();
            writeNpcMemories(state, char, store);
            saveStateToMetadata(state, { label: 'NPC memories', recordHistory: false });
            syncProfileToLore(char, store).catch(err =>
                console.error(LOG_PREFIX, 'Could not update lorebook memories', err));
        },
        fields: profileFieldsForCard(char),
        limit: getSettings().statusTracker?.presets?.[getSettings().activeSystem]
            ?.definition?.memories?.maxEntriesPerCharacter,
    });
}
