import { refreshExtensionEnabled } from './src/entry/entry-enabled.js';
import { buildSettingToggle } from './src/ui/shared/ui-shared.js';
import { eventSource, event_types } from '../../../events.js';
import { onMessageRendered, onMessageForExtraction, onSwipe, onRegenerateStarted, onMessageDeleted, onMessageEdited } from './src/entry/entry-message-events.js';
import { wireAvatarClicks } from './src/entry/entry-avatar-actions.js';
import { offerChatScope } from './src/entry/entry-chat-scope.js';
import { syncActiveProfileLore } from './src/entry/entry-profile-lore.js';
import { dropCopiedWorldNote } from './src/entry/entry-history-notes.js';
import { allowStoryPlayerDialogue, restorePlayerDialogueSetting } from './src/entry/entry-generation-names.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { LOG_PREFIX, extensionName, debugLog } from './src/core/constants.js';
import { initSettings, getSettings } from './src/core/settings.js';
import { REVIEW_EVENT } from './src/tracker/status-review.js';
import { repairDefaultImages } from './src/characters/default-portraits.js';
import { migrateImagesToFolders } from './src/characters/character-images.js';
import { 
    openManagePopup
} from './src/ui/manage/ui-manage.js';
import {
    reprocessAllMessages,
    reprocessMessage,
    setReprocessCallback,
    invalidateChatRender,
} from './src/chat/chat.js';
import { redrawStatusBoxes } from './src/tracker/ui/status-ui.js';
import { syncLorebookScope, repairEntryIdentities } from './src/lore/lorebook.js';
import { initStatusLogic, setSwipeBaseAligner } from './src/tracker/status-logic.js';
import { alignSwipeBaseToNow } from './src/tracker/snapshots/status-snapshots.js';
import { resetExtractionState } from './src/tracker/extractor/status-extractor.js';
import { initHUD, updateHUD, forgetPortrait } from './src/ui/hud/ui-hud.js';
import { refreshScanButton } from './src/ui/tracker/ui-scan-button.js';
import { refreshReadButton } from './src/ui/tracker/ui-read-button.js';
import { refreshMemoryButton } from './src/ui/tracker/ui-memory-button.js';
import { setMemoryButtonRefresh, resetMemorySchedule } from './src/memory/memory-reader.js';
import { applyPortraitFraming, applySpeechPadding } from './src/ui/shared/ui-shared.js';
import { applyScenePrompt } from './src/tracker/status-logic.js';
import { noteActivatedLore } from './src/lore/activated-lore.js';
import { setDebugLogging } from './src/core/constants.js';
import { describeChatConnection } from './src/core/utils.js';
import { applyDialogueFormatPrompt } from './src/prompts/dialogue-format.js';
import { placeWritingPrompt } from './src/prompts/prompt-slot.js';
import { applyBanList } from './src/prompts/banlist.js';

async function addSettingsPanel() {
    try {
        const html = await renderExtensionTemplateAsync(extensionName, 'index');
        $('#extensions_settings2').append(html);
        document.getElementById('sillynpc-enable-setting')?.append(buildSettingToggle({
            key: 'enabled',
            label: 'Enable SillyNPC',
            help: 'Turn off chat decorations, prompts, the HUD and background reading. Saved characters and tracker data are kept.',
            onChange: refreshExtensionEnabled,
        }));
        refreshScanButton();
        refreshReadButton();
        refreshMemoryButton();

        document.getElementById('sillynpc-open-manage')?.addEventListener('click', () => {
            openManagePopup().catch(err => console.error(LOG_PREFIX, 'openManagePopup failed', err));
        });
    } catch (err) {
        console.error(LOG_PREFIX, 'failed to load settings panel', err);
    }
}

jQuery(async () => {
    try {
        initSettings();
        // Apply saved logging and portrait settings before startup work.
        setDebugLogging(getSettings().debugLogging);
        applyPortraitFraming();
        applySpeechPadding();
        // Portrait repairs run in the background; failures retry on the next load.
        repairDefaultImages().catch(err => console.warn(LOG_PREFIX, 'Portrait repair failed', err));
        migrateImagesToFolders()
            .then(({ moved, characters, failed }) => {
                if (moved) {
                    console.log(LOG_PREFIX,
                        `Moved ${moved} picture(s) into folders for ${characters} character(s)`);
                }
                if (failed) {
                    console.warn(LOG_PREFIX,
                        `Stopped moving pictures into folders at ${failed}; will resume next load`);
                }
            })
            .catch(err => console.warn(LOG_PREFIX, 'Could not move pictures into folders', err));
        initStatusLogic();
        setMemoryButtonRefresh(refreshMemoryButton);
        resetMemorySchedule();
        syncActiveProfileLore().catch(err => console.error(LOG_PREFIX, 'Profile lore sync failed', err));
        try {
            initHUD();
        } catch (hudErr) {
            console.error(LOG_PREFIX, 'initHUD failed', hudErr);
        }
        setReprocessCallback(reprocessAllMessages);
        // Register the aligner to preserve manual corrections without a circular import.
        setSwipeBaseAligner(alignSwipeBaseToNow);
        await addSettingsPanel();
        wireAvatarClicks();
        // Presets replace the prompt list, so restore managed prompts and refresh the HUD.
        eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
            // Keep portrait refresh independent of prompt failures.
            try {
                forgetPortrait();
                updateHUD();
            } catch (err) {
                debugLog('Could not redraw the HUD after the preset change', err);
            }

            try {
                applyDialogueFormatPrompt();
            } catch (err) {
                debugLog('Could not put the writing prompts back after the preset change', err);
            }
        });

        // Skip prompt-measurement dry runs when logging the active connection.
        eventSource.on(event_types.GENERATION_STARTED, (_type, _options, dryRun) => {
            if (dryRun) return;
            debugLog(describeChatConnection());
            try {
                // Clear an old prompt-list copy of the retired duplicate rule.
                placeWritingPrompt('sillynpc-narrator-rules', '');
                applyDialogueFormatPrompt();
                applyBanList();
            } catch (err) {
                debugLog('Could not set what is injected into the story prompt', err);
            }
        });

        eventSource.on(event_types.GENERATION_STARTED, allowStoryPlayerDialogue);
        eventSource.on(event_types.GENERATION_ENDED, restorePlayerDialogueSetting);
        eventSource.on(event_types.GENERATION_STOPPED, restorePlayerDialogueSetting);

        // Refresh the scene prompt after lore activation, before host chat injection.
        eventSource.on(event_types.WORLD_INFO_ACTIVATED, (entries) => {
            try {
                if (getSettings().enabled) noteActivatedLore(entries);
                applyScenePrompt();
            } catch (err) {
                debugLog('Could not record activated lore', err);
            }
        });

        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageForExtraction);
        eventSource.on(event_types.USER_MESSAGE_RENDERED, onMessageRendered);
        eventSource.on(event_types.MESSAGE_UPDATED, onMessageRendered);
        // Existing swipes need decoration without a new generation event.
        eventSource.on(event_types.MESSAGE_SWIPED, onSwipe);

        // Before it is drawn, and again after, since a streamed reply skips the first.
        eventSource.on(event_types.MESSAGE_RECEIVED, (id) => dropCopiedWorldNote(id, false));
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (id) => dropCopiedWorldNote(id, true));
        // Restore the selected reply's state before the tracker builds the generation prompt.
        eventSource.makeFirst(event_types.GENERATION_STARTED, onRegenerateStarted);
        eventSource.on(event_types.MESSAGE_DELETED, onMessageDeleted);
        eventSource.on(event_types.MESSAGE_EDITED, onMessageEdited);
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
            // Loading history changes the DOM without changing the render signature.
            invalidateChatRender();
            reprocessAllMessages();
        });
        eventSource.on(event_types.CHAT_CHANGED, () => {
            invalidateChatRender();
            reprocessAllMessages();
        });
        eventSource.on(event_types.CHAT_CHANGED, resetExtractionState);
        eventSource.on(event_types.CHAT_CHANGED, resetMemorySchedule);
        eventSource.on(event_types.CHAT_CHANGED, syncActiveProfileLore);
        eventSource.on(event_types.PERSONA_CHANGED, syncActiveProfileLore);
        // Repair missing lorebook headings only when necessary.
        eventSource.on(event_types.CHAT_CHANGED, () => {
            if (!getSettings().enabled) return;
            repairEntryIdentities().catch(err =>
                console.error(LOG_PREFIX, 'Naming lorebook entries failed', err));
        });
        // The HUD has to re-evaluate on every chat switch: it hides when none is open.
        eventSource.on(event_types.CHAT_CHANGED, () => updateHUD());
        eventSource.on(event_types.CHAT_CHANGED, () => {
            if (!getSettings().enabled) return;
            offerChatScope().catch(err => console.error(LOG_PREFIX, 'offerChatScope failed', err));
            syncLorebookScope().catch(err => console.error(LOG_PREFIX, 'syncLorebookScope failed', err));
        });
        eventSource.on(event_types.PERSONA_CHANGED, () => {
            try {
                updateHUD();
            } catch (err) {
                console.error(LOG_PREFIX, 'PERSONA_CHANGED HUD update failed', err);
            }
        });

        eventSource.on(event_types.CHARACTER_EDITED, () => {
            try {
                updateHUD();
                reprocessAllMessages();
            } catch (err) {
                console.error(LOG_PREFIX, 'CHARACTER_EDITED HUD update failed', err);
            }
        });

        eventSource.on(REVIEW_EVENT, ({ messageId } = {}) => {
            try {
                const mesEl = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
                if (mesEl) reprocessMessage(mesEl);
            } catch (err) {
                console.error(LOG_PREFIX, 'review refresh failed', err);
            }
        });

        eventSource.on('sillynpc-player-portrait-changed', () => {
            try {
                updateHUD();
                reprocessAllMessages();
            } catch (err) {
                console.error(LOG_PREFIX, 'player portrait refresh failed', err);
            }
        });

        eventSource.on('sillynpc-status-updated', () => {
            try {
                updateHUD();
                // Refresh tracker boxes without redecorating the full chat.
                redrawStatusBoxes();
            } catch (err) {
                console.error(LOG_PREFIX, 'sillynpc-status-updated refresh failed', err);
            }
        });

        eventSource.on('sillynpc-open-manage', (data) => {
            openManagePopup(data).catch(err => console.error(LOG_PREFIX, 'openManagePopup failed', err));
        });

        console.log(LOG_PREFIX, 'extension loaded successfully', { extensionName });
    } catch (err) {
        console.error(LOG_PREFIX, 'CRITICAL: Extension failed to load during jQuery ready!', err);
    }
});
