import { LOG_PREFIX } from '../../core/constants.js';
import { getSettings } from '../../core/settings.js';
import { profileFieldsForCard } from '../../core/profile-fields.js';
import { syncProfileToLore } from '../../lore/lore-sync.js';
import { loadStateFromMetadata, saveStateToMetadata } from '../../tracker/status-logic.js';
import { readNpcMemories, writeNpcMemories } from '../../tracker/npc-memories.js';
import { renderMemorySection } from './ui-memories.js';

/** Chat-owned memories, with player and NPC storage resolved at the save boundary. */
export function renderCharacterMemorySection(char, container) {
    return renderMemorySection(container, {
        read: () => char.isPlayer ? loadStateFromMetadata().player?.memories : readNpcMemories(loadStateFromMetadata(), char),
        write: store => {
            const state = loadStateFromMetadata();
            if (char.isPlayer) state.player.memories = store;
            else writeNpcMemories(state, char, store);
            saveStateToMetadata(state, { label: char.isPlayer ? 'Player memories' : 'NPC memories', recordHistory: false });
            syncProfileToLore(char, store).catch(err =>
                console.error(LOG_PREFIX, 'Could not update lorebook memories', err));
        },
        fields: profileFieldsForCard(char),
        limit: getSettings().statusTracker?.presets?.[getSettings().activeSystem]
            ?.definition?.memories?.maxEntriesPerCharacter,
    });
}
