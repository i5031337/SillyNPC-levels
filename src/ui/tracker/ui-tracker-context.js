import { getSettings, saveSettings, defaultSettings } from '../../core/settings.js';
import { buildPromptEditor } from '../shared/ui-prompts.js';
import { promptById } from '../../prompts/prompts.js';
import { tidyTemplateLabels } from '../shared/ui-template-tidy.js';
import { buildSettingToggle, buildSettingTextArea, buildSettingSlider, buildSettingSelect, buildSettingNumber, updateExtensionTheme, repositionCloseButton } from '../shared/ui-shared.js';
import { loadStateFromMetadata, saveStateToMetadata, syncPlayerToMaster, applyCheckpointSchedule, getHistoryEntries, restoreHistoryEntry } from '../../tracker/status-logic.js';
import { POPUP_TYPE, Popup } from '../../../../../../popup.js';
import { eventSource } from '../../../../../../events.js';
import { triggerReprocess } from '../../chat/chat.js';
import { updateHUD } from '../hud/ui-hud.js';
import { escapeHtml } from '../../core/utils.js';
import { cleanChatHistory, measureChatOverhead, estimateTokens } from '../../tracker/status-history.js';
import { buildConnectionProfilePicker } from '../settings/ui-connection-profiles.js';

export function buildContextReport(onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.style.marginTop = '20px';
    title.textContent = 'Chat Size';
    wrap.appendChild(title);

    const body = document.createElement('div');
    wrap.appendChild(body);

    const render = () => {
        body.replaceChildren();

        let stats;
        try {
            stats = measureChatOverhead();
        } catch {
            const note = document.createElement('small');
            note.className = 'notes';
            note.textContent = 'No chat is open.';
            body.appendChild(note);
            return;
        }

        const totalTokens = estimateTokens(stats.totalChars);
        const blockTokens = estimateTokens(stats.blockChars);
        const share = stats.totalChars ? (stats.blockChars / stats.totalChars * 100) : 0;

        const summary = document.createElement('small');
        summary.className = 'notes';
        summary.style.display = 'block';
        summary.style.marginBottom = '8px';
        summary.textContent = `${stats.messages} messages, roughly ${totalTokens.toLocaleString()} tokens. `
            + (stats.blockMessages
                ? `${stats.blockMessages} of them still carry tracker data: about ${blockTokens.toLocaleString()} tokens (${share.toFixed(1)}%), re-sent on every turn.`
                : 'No leftover tracker data - nothing is being re-sent.');
        body.appendChild(summary);

        if (!stats.blockMessages) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button';
        button.innerHTML = '<i class="fa-solid fa-broom"></i> Remove tracker data from this chat';
        button.addEventListener('click', async () => {
            const ok = await Popup.show.confirm(
                'Clean this chat?',
                `This removes the tracker's own JSON from ${stats.blockMessages} message(s), `
                + `recovering roughly ${blockTokens.toLocaleString()} tokens on every future request. `
                + 'The story text is untouched, and the removed data is kept hidden on each '
                + 'message so it can still be re-applied. Back up the chat first if you are unsure.');
            if (!ok) return;

            const result = cleanChatHistory();
            toastr.success(
                `Cleaned ${result.cleaned} message(s), recovering about `
                + `${estimateTokens(result.removedChars).toLocaleString()} tokens.`,
                'SillyNPC');
            render();
            onChange?.();
        });
        body.appendChild(button);
    };

    render();
    return wrap;
}

/**
 * Connection Profile picker for the extraction request.
 *
 * Connection Manager is an extension and can be disabled, in which case
 * getSupportedProfiles() throws - so this degrades to an explanatory note rather than
 * breaking the settings panel. An empty selection means "use the main API".
 */
/**
 * The Time Rules section.
 *
 * What elapsed time does on its own - Energy recovering while the party rests, a torch
 * burning down, hunger climbing. The extension computes these from the clock the
 * narrator already writes, so they are exact and cost nothing; the model is never asked
 * to do the arithmetic.
 */
