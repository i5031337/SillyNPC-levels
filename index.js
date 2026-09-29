import { eventSource, event_types } from '../../../events.js';
import { onMessageRendered, onMessageForExtraction, onSwipe, onRegenerateStarted, onMessageDeleted, onMessageEdited } from './src/entry/entry-message-events.js';
import { wireAvatarClicks } from './src/entry/entry-avatar-actions.js';
import { offerChatScope } from './src/entry/entry-chat-scope.js';
import { dropCopiedWorldNote } from './src/entry/entry-history-notes.js';
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
import { applyPortraitFraming, applySpeechPadding } from './src/ui/shared/ui-shared.js';
import { applyScenePrompt } from './src/tracker/status-logic.js';
import { noteActivatedLore } from './src/lore/activated-lore.js';
import { setDebugLogging } from './src/core/constants.js';
import { describeChatConnection } from './src/core/utils.js';
import { applyDialogueFormatPrompt } from './src/prompts/dialogue-format.js';
import { applyNarratorRulesPrompt } from './src/prompts/narrator-rules.js';
import { applyBanList } from './src/prompts/banlist.js';

async function addSettingsPanel() {
    try {
        const html = await renderExtensionTemplateAsync(extensionName, 'index');
        $('#extensions_settings2').append(html);
        refreshScanButton();

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
        // Before the first request, so a saved choice is in force for it.
        setDebugLogging(getSettings().debugLogging);
        // Before anything draws a portrait. The stylesheet falls back to `top` on its own,
        // so this only matters for a saved choice other than the default.
        applyPortraitFraming();
        applySpeechPadding();
        // Not awaited: a fallback portrait still held inside settings.json works exactly
        // as it is, so nothing needs to wait for it to become a file on disk. Failures are
        // logged and tried again next time.
        repairDefaultImages().catch(err => console.warn(LOG_PREFIX, 'Portrait repair failed', err));
        /* Every character's pictures into a folder of their own, once.
         *
         * Not awaited, for the same reason as the line above: a picture still in the flat
         * folder is a picture that works, so nothing here needs to wait for it to move, and
         * a failure costs only that it is tried again on the next load. Copy, confirm,
         * re-point, delete - so an interruption never leaves a card pointing at a file that
         * is not there. See migrateImagesToFolders. */
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
        try {
            initHUD();
        } catch (hudErr) {
            console.error(LOG_PREFIX, 'initHUD failed', hudErr);
        }
        setReprocessCallback(reprocessAllMessages);
        /* A correction made by hand has to survive a swipe. Registered rather than
           imported: the aligner lives in status-snapshots, which already imports
           status-logic, and an edge back the other way would be a cycle. */
        setSwipeBaseAligner(alignSwipeBaseToNow);
        await addSettingsPanel();
        wireAvatarClicks();
        /* A preset carries its own prompt list, so loading one throws away the entries
           the two writing prompts are placed by - not the settings that ask for them.
           Written again here, which puts them back at the foot of the new list.
           Nothing happens for a block that is not managed there. */
        eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
            /* Redrawn first, and in a try of its own.
             *
             * Reported as the HUD's portrait disappearing on a preset change and staying
             * gone until the page was reloaded. Nothing else asks the HUD to draw again -
             * none of the events that do, a message or a chat change or a settings
             * control, fires when a preset is swapped - so whatever leaves the picture
             * unusable, the recovery inside updateHUD never gets a turn.
             *
             * It was added below the two calls that follow, which was the mistake: the
             * catch around them exists because they are expected to fail sometimes, and
             * putting the redraw behind them let a failure in the prompt work silently
             * take the HUD with it. Two unrelated jobs, two failure paths. */
            try {
                // Rebuilt rather than merely redrawn - see forgetPortrait for which of the
                // remaining explanations that covers, and which it does not.
                forgetPortrait();
                updateHUD();
            } catch (err) {
                debugLog('Could not redraw the HUD after the preset change', err);
            }

            try {
                applyDialogueFormatPrompt();
                applyNarratorRulesPrompt();
            } catch (err) {
                debugLog('Could not put the writing prompts back after the preset change', err);
            }
        });

        // Logged beside SillyNPC's own request lines, so "what does the chat use" and
        // "what does the extension use" can be compared at a glance instead of by reading
        // secrets.json. Dry runs are skipped: SillyTavern fires several per message while
        // measuring the prompt, and they would bury the real one.
        eventSource.on(event_types.GENERATION_STARTED, (_type, _options, dryRun) => {
            if (dryRun) return;
            debugLog(describeChatConnection());
            // Here rather than in the tracker's own handler: that one returns early when
            // the tracker is off, and the chat is still decorated then.
            try {
                applyDialogueFormatPrompt();
                applyNarratorRulesPrompt();
                applyBanList();
            } catch (err) {
                debugLog('Could not set what is injected into the story prompt', err);
            }
        });

        /* Fires while SillyTavern assembles the story prompt, and - contrary to what this
           comment used to say - in time to change it. getWorldInfoPrompt, which emits
           this, is awaited at script.js:4576; doChatInject, which reads our IN_CHAT
           blocks, runs at 4686.

           So the scene block is written again here, now that we know whose entries fired.
           A character whose lore reached the prompt without their stats or their profile
           is one the narrator has to invent the moment it gives them a line. */
        eventSource.on(event_types.WORLD_INFO_ACTIVATED, (entries) => {
            try {
                noteActivatedLore(entries);
                applyScenePrompt();
            } catch (err) {
                debugLog('Could not record activated lore', err);
            }
        });

        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageRendered);
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageForExtraction);
        eventSource.on(event_types.USER_MESSAGE_RENDERED, onMessageRendered);
        eventSource.on(event_types.MESSAGE_UPDATED, onMessageRendered);
        // Swiping between replies that already exist rewrites the message in place and
        // emits nothing else - no generation runs, so CHARACTER_MESSAGE_RENDERED never
        // fires. The new text arrived undecorated and stayed that way until something
        // else redrew the chat.
        eventSource.on(event_types.MESSAGE_SWIPED, onSwipe);

        // Before it is drawn, and again after, since a streamed reply skips the first.
        eventSource.on(event_types.MESSAGE_RECEIVED, (id) => dropCopiedWorldNote(id, false));
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (id) => dropCopiedWorldNote(id, true));
        /* Regenerate is not a swipe, and says so through neither of the events above.

           makeFirst rather than on, and it matters. status-logic listens to the same event
           to build the scene block it injects, and it registered first, so it ran first:
           the prompt for the regenerated reply was built from the state the *discarded*
           reply had left behind. Restoring state first lets the next story prompt use
           only the selected reply's committed values.

           Ordering is the only lever here, since both listen to the same event, so it is
           declared out loud instead of resting on which line of this function runs first. */
        eventSource.makeFirst(event_types.GENERATION_STARTED, onRegenerateStarted);
        eventSource.on(event_types.MESSAGE_DELETED, onMessageDeleted);
        eventSource.on(event_types.MESSAGE_EDITED, onMessageEdited);
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
            // The signature describes the settings, not the DOM, and these two change
            // which messages exist without changing a setting - so they have to say
            // so, or a redraw that has learned to decline will decline this one.
            invalidateChatRender();
            reprocessAllMessages();
        });
        eventSource.on(event_types.CHAT_CHANGED, () => {
            invalidateChatRender();
            reprocessAllMessages();
        });
        eventSource.on(event_types.CHAT_CHANGED, resetExtractionState);
        // Entries written before they carried a heading are named here, once, rather than
        // waiting to be regenerated by hand. It writes only where something differs, so a
        // chat switch with nothing to fix touches no files.
        eventSource.on(event_types.CHAT_CHANGED, () => {
            repairEntryIdentities().catch(err =>
                console.error(LOG_PREFIX, 'Naming lorebook entries failed', err));
        });
        // The HUD has to re-evaluate on every chat switch: it hides when none is open.
        eventSource.on(event_types.CHAT_CHANGED, () => updateHUD());
        eventSource.on(event_types.CHAT_CHANGED, () => {
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
                // The tracker state moved, which changes the tracker boxes and nothing
                // else. This called reprocessAllMessages(), so every extracted message -
                // that is, every message - redrew the speaker decoration, the portraits
                // and the avatars over the whole chat as well. redrawStatusBoxes exists
                // for exactly this case and says so in its own comment.
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
