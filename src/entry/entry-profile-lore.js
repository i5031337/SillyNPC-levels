import { getContext } from '../../../../../st-context.js';
import { getActiveCharacters } from '../characters/characters.js';
import { getPlayerCard } from '../tracker/status-logic.js';
import { syncProfileToLore } from '../lore/lore-sync.js';
import { getSettings } from '../core/settings.js';
import { LOG_PREFIX } from '../core/constants.js';

/** Keep saved profiles available through lore instead of the scene prompt. */
export async function syncActiveProfileLore() {
    if (!getSettings().enabled || !getContext()?.getCurrentChatId?.()) return;
    const metadata = getContext().chatMetadata;
    const cards = [...getActiveCharacters(), getPlayerCard()];
    for (const card of cards) {
        if (getContext()?.chatMetadata !== metadata) return;
        if (!Object.values(card.profile || {}).some(value => String(value ?? '').trim())) continue;
        try { await syncProfileToLore(card); }
        catch (error) { console.error(LOG_PREFIX, `Could not save ${card.name}'s profile to lore`, error); }
    }
}
