import { getSettings } from '../../core/settings.js';
import { LOG_PREFIX } from '../../core/constants.js';
import { makeActivatable } from '../../core/utils.js';
import { readMemories, memoryReaderBusy } from '../../memory/memory-reader.js';

const BUTTON_ID = 'sillynpc-memory-button';
let clicked = false;

function enabled() {
    const settings = getSettings();
    return settings.enabled && settings.statusTracker?.presets?.[settings.activeSystem]
        ?.definition?.memories?.enabled === true;
}

/** Occasional NPC memory reading stays available independently of the stat tracker. */
export function refreshMemoryButton() {
    if (!enabled()) {
        document.getElementById(BUTTON_ID)?.remove();
        return;
    }
    let button = document.getElementById(BUTTON_ID);
    if (!button) {
        const host = document.getElementById('leftSendForm');
        if (!host) return;
        button = document.createElement('div');
        button.id = BUTTON_ID;
        button.className = 'fa-solid fa-brain interactable sillynpc-scan-button';
        button.tabIndex = 0;
        button.title = 'Read memories now';
        makeActivatable(button);
        button.addEventListener('click', onMemoryClicked);
        host.appendChild(button);
    }
    const busy = clicked || memoryReaderBusy();
    button.classList.toggle('sillynpc-scanning', busy);
    button.setAttribute('aria-disabled', String(busy));
    button.setAttribute('aria-busy', String(busy));
    button.title = busy ? 'Reading NPC memories…' : 'Read memories now';
    button.setAttribute('aria-label', button.title);
}

async function onMemoryClicked() {
    if (!enabled() || clicked || memoryReaderBusy()) return;
    clicked = true;
    refreshMemoryButton();
    try {
        const result = await readMemories({ manual: true });
        if (!result.ok) {
            toastr.info(result.reason || 'The memory reading did not complete.', 'SillyNPC');
        } else if (result.pending) {
            toastr.info(`${result.pending} memor${result.pending === 1 ? 'y' : 'ies'} awaiting review under the last message.`, 'SillyNPC');
        } else {
            toastr.success('Memory reading complete. Nothing to add.', 'SillyNPC');
        }
        if (result.ok && result.remainingReplies > 0) {
            toastr.info(`${result.remainingReplies} unread repl${result.remainingReplies === 1 ? 'y remains' : 'ies remain'}. Use Read memories now again to continue.`, 'SillyNPC');
        }
    } catch (error) {
        console.error(LOG_PREFIX, 'Memory reading failed', error);
        toastr.error(String(error?.message || error), 'SillyNPC');
    } finally {
        clicked = false;
        refreshMemoryButton();
    }
}
