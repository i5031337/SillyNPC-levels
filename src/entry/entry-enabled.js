import { disconnectStatusObservers } from '../tracker/ui/status-ui-process.js';
import { getSettings } from '../core/settings.js';
import { triggerReprocess } from '../chat/reprocess.js';
import { resetExtractionState } from '../tracker/extractor/status-extractor.js';
import { applyScenePrompt } from '../tracker/status-logic.js';
import { applyDialogueFormatPrompt } from '../prompts/dialogue-format.js';
import { applyBanList } from '../prompts/banlist.js';
import { restorePlayerDialogueSetting } from './entry-generation-names.js';
import { updateHUD } from '../ui/hud/ui-hud.js';
import { refreshReadButton } from '../ui/tracker/ui-read-button.js';
import { refreshScanButton } from '../ui/tracker/ui-scan-button.js';

/** Apply the master switch immediately; keep saved characters and tracker state. */
export function refreshExtensionEnabled() {
    document.querySelectorAll('.sillynpc-setting[data-setting="enabled"] input[type="checkbox"]').forEach(input => {
        input.checked = getSettings().enabled;
    });
    if (!getSettings().enabled) {
        resetExtractionState();
        disconnectStatusObservers();
        restorePlayerDialogueSetting();
    }
    applyScenePrompt();
    applyDialogueFormatPrompt();
    applyBanList();
    updateHUD();
    refreshReadButton();
    refreshScanButton();
    triggerReprocess();
}
