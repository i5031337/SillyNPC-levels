import { getContext } from '../../../../../../st-context.js';
import { LOG_PREFIX } from '../../core/constants.js';
import { createCharacter, addCharacterToChat } from '../../characters/characters.js';
import { findCardForName } from '../../tracker/status-logic.js';
import { triggerReprocess } from '../../chat/reprocess.js';
import { fillCharacter } from './ui-fill.js';

const filling = new Set();

/** Create and fill an unsaved NPC from either a speaker portrait or a tracker row. */
export async function fillNewCharacter(rawName, { onSave } = {}) {
    const name = String(rawName || '').trim();
    if (!name) return;
    const key = `${getContext()?.getCurrentChatId?.() || ''}:${name.toLowerCase()}`;
    if (filling.has(key)) return;
    filling.add(key);
    const redraw = () => { triggerReprocess(); onSave?.(); };
    try {
        // A stale control can survive until redraw; reuse its card rather than duplicate it.
        const char = findCardForName(name) || createCharacter(name);
        addCharacterToChat(char.id);
        redraw();
        await fillCharacter(char, { preset: 'automatic', onSave: redraw });
        return char;
    } catch (err) {
        console.error(LOG_PREFIX, 'Could not start character Fill', err);
        toastr.error(`Fill could not start: ${err?.message || err}`, 'SillyNPC');
    } finally {
        filling.delete(key);
    }
}
