import { renderExtensionTemplateAsync } from '../../../../../../extensions.js';
import { POPUP_TYPE, Popup } from '../../../../../../popup.js';
import { eventSource, event_types } from '../../../../../../events.js';
import { extensionName, LOG_PREFIX } from '../../core/constants.js';
import { getSettings } from '../../core/settings.js';
import { reprocessAllMessages, chatRenderSignature } from '../../chat/chat.js';
import { resetLorebookState } from '../story/ui-lorebook-section.js';
import { renderGoalsView } from '../story/ui-goals.js';
import {
    renderAppearanceView,
    renderWritingRulesView,
    renderAdvancedView,
    renderGenerationSettingsView,
} from '../settings/ui-settings-tabs.js';
import { renderStatsView } from '../shared/ui-stats.js';
import { renderStatusView } from '../tracker/ui-tracker-settings.js';
import { renderHudView } from '../hud/ui-hud-settings.js';
import { buildSystemBuilder } from '../system/ui-system-builder.js';
import { buildSystemManager } from '../system/ui-system-manager.js';
import { updateExtensionTheme, repositionCloseButton, hideEmptySections } from '../shared/ui-shared.js';
import { buildSettingsSearch, buildSettingsIndex } from '../settings/ui-settings-search.js';

import { manageState } from './ui-manage-state.js';
import { renderCardGrid } from './ui-manage-grid.js';
import { renderEditor } from './ui-manage-editor.js';
import { renderPlayerView, commitOpenEdits } from '../characters/ui-player-sheet.js';
import { exportData, importData } from './ui-manage-transfer.js';

// The menu can stay open while SillyTavern changes the current chat or persona.
// Redraw after the host has loaded the new state; do not write old fields into it.
for (const type of [event_types.CHAT_CHANGED, event_types.PERSONA_CHANGED]) {
    eventSource.on(type, () => setTimeout(() => {
        if (manageState.manageRoot && manageState.activeTab === 'player') renderManageView();
    }, 0));
}
eventSource.on('sillynpc-status-updated', () => {
    if (!manageState.manageRoot || manageState.activeTab !== 'player') return;
    const focused = document.activeElement;
    if (focused && manageState.manageRoot.contains(focused)
        && (focused.matches('input, textarea, select, [contenteditable="true"]'))) return;
    renderManageView();
});


export async function openManagePopup({ tab = 'characters', charId = null } = {}) {
    if (manageState.managePopup && manageState.manageRoot) {
        if (manageState.activeTab === 'player') commitOpenEdits(manageState.manageRoot);
        manageState.editingCharId = charId;
        manageState.activeTab = tab;
        renderManageView();
        return;
    }
    const html = await renderExtensionTemplateAsync(extensionName, 'manage');
    const container = document.createElement('div');
    container.innerHTML = html;
    container.style.height = '100%';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';

    // Taken before the menu can change anything, and compared when it closes.
    const signatureOnOpen = chatRenderSignature();

    manageState.managePopup = new Popup(container, POPUP_TYPE.DISPLAY, '', {
        allowVerticalScrolling: false,
        onClosing: () => {
            if (manageState.activeTab === 'player') commitOpenEdits(container);
            return true;
        },
        onOpen: (popup) => {
            applyPopupSize();
            updateManageTheme(manageState.manageRoot, popup);
            const visualContent = container.querySelector('.sillynpc-manage');
            if (visualContent) repositionCloseButton(popup, visualContent);
        },
        onClose: () => {
            manageState.managePopup = null;
            manageState.manageRoot = null;
            manageState.editingCharId = null;
            // Only when something that affects the chat actually changed. This used to run
            // every time, so opening the menu, reading something and closing it again
            // redrew a hundred messages for nothing - which is the stalled scrolling you
            // felt for a second afterwards.
            //
            // It cannot simply go: editing a character's name or colour only saves, and
            // this redraw is what applies it. A signature catches those without needing
            // every mutation site instrumented.
            if (chatRenderSignature() !== signatureOnOpen) reprocessAllMessages();
        },
    });
    
    manageState.manageRoot = container;
    manageState.editingCharId = charId;
    manageState.charView = 'profile';
    manageState.activeTab = tab;
    
    resetLorebookState();
    setupTabBar();
    setupSettingsSearch();
    renderManageView();

    await manageState.managePopup.show();
}

function applyPopupSize() {
    const dlg = manageState.managePopup?.dlg;
    if (!dlg) return;
    
    // Check if we are on a small screen
    const isMobile = window.innerWidth <= 768;
    const width = isMobile ? 95 : (getSettings().popupWidth ?? 80);
    const height = isMobile ? 90 : (getSettings().popupHeight ?? 80);
    
    dlg.style.setProperty('width', `${width}vw`, 'important');
    dlg.style.setProperty('max-width', '98vw', 'important');
    dlg.style.setProperty('height', `${height}vh`, 'important');
    dlg.style.setProperty('max-height', '98vh', 'important');
    
    if (isMobile) {
        dlg.style.setProperty('margin', '2vh auto', 'important');
    }

    // ─── ADD THESE LINES TO SOLVE THE PROBLEM ────────────────────────
    dlg.style.setProperty('padding', '0px', 'important');          // Removes the 20px padding gap
    dlg.style.setProperty('background', 'transparent', 'important'); // Makes the parent container invisible
    dlg.style.setProperty('border', 'none', 'important');          // Removes any actual borders
    dlg.style.setProperty('box-shadow', 'none', 'important');      // Removes any glowing shadows
}

function setupTabBar() {
    if (!manageState.manageRoot) return;
    const tabs = manageState.manageRoot.querySelectorAll('.sillynpc-tab');
    
    tabs.forEach(tab => {
        const name = tab.getAttribute('data-tab');
        if (!name) return;
        tab.replaceWith(tab.cloneNode(true));
    });
    
    const freshTabs = manageState.manageRoot.querySelectorAll('.sillynpc-tab');
    freshTabs.forEach(tab => {
        const name = tab.getAttribute('data-tab');
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            switchTab(name);
        });
    });
}

/**
 * The box above the tabs, and what happens when an answer is picked.
 *
 * The index is built the first time somebody searches rather than when the menu opens:
 * it draws every page to make it, and most visits never type anything.
 */
function setupSettingsSearch() {
    const slot = manageState.manageRoot.querySelector('#sillynpc-settings-search');
    if (!slot) return;
    slot.replaceChildren();
    slot.append(buildSettingsSearch({
        index: () => buildSettingsIndex(settingsTabs()),
        onPick: (entry) => {
            switchTab(entry.tab);
            revealSetting(entry.key);
        },
    }));
}

/**
 * Scrolls to a setting and marks it, having just switched to its page.
 *
 * Marked because a page can be long: arriving somewhere with no idea which of thirty rows
 * you were brought for is barely better than not being brought.
 *
 * @param {string} key
 */
function revealSetting(key) {
    const wrap = manageState.manageRoot?.querySelector(`[data-setting="${key}"]`);
    if (!wrap) return;
    wrap.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    wrap.classList.add('sillynpc-setting-found');
    // Long enough to find by eye, short enough that it is gone before it becomes part of
    // how the page looks.
    setTimeout(() => wrap.classList.remove('sillynpc-setting-found'), 2400);
}

function switchTab(name) {
    if (!manageState.manageRoot) return;
    if (manageState.activeTab === 'player') commitOpenEdits(manageState.manageRoot);
    manageState.activeTab = name;
    manageState.editingCharId = null;
    resetLorebookState();
    renderManageView();
}

function openEditor(id) {
    manageState.editingCharId = id;
    manageState.charView = 'profile';
    manageState.activeTab = 'characters';
    resetLorebookState();
    renderManageView();
}

export function renderManageView() {
    if (!manageState.manageRoot) return;

    // Update tab button states
    const tabs = manageState.manageRoot.querySelectorAll('.sillynpc-tab');
    tabs.forEach(t => {
        const tName = t.getAttribute('data-tab');
        t.classList.toggle('active', tName === manageState.activeTab);
    });

    // Toggle panel visibility
    const panels = manageState.manageRoot.querySelectorAll('.sillynpc-tab-panel');
    panels.forEach(p => {
        const pName = p.getAttribute('data-panel');
        const isCurrent = pName === manageState.activeTab;
        p.style.setProperty('display', isCurrent ? 'flex' : 'none', 'important');
    });

    updateManageTheme(manageState.manageRoot, manageState.managePopup);

    /** Draws one panel, naming it if it goes wrong rather than leaving a blank tab. */
    const draw = (id, render) => {
        const view = manageState.manageRoot.querySelector(`#${id}`);
        if (!view) return;
        try {
            render(view);
            // After, not during: a section is empty only once everything in it has had
            // its chance to be drawn or hidden.
            hideEmptySections(view);
        } catch (e) { console.error(LOG_PREFIX, `${id} failed`, e); }
    };

    if (manageState.activeTab === 'player') {
        draw('sillynpc-player-view', renderPlayerView);
    } else if (manageState.activeTab === 'characters') {
        const gridView = manageState.manageRoot.querySelector('#sillynpc-grid-view');
        const editView = manageState.manageRoot.querySelector('#sillynpc-editor-view');
        if (manageState.editingCharId) {
            if (gridView) gridView.style.display = 'none';
            if (editView) {
                editView.style.display = 'block';
                try { renderEditor(renderManageView); } catch (e) { console.error(LOG_PREFIX, 'renderEditor failed', e); }
            }
        } else {
            if (gridView) {
                gridView.style.display = 'block';
                try { renderCardGrid(openEditor); } catch (e) { console.error(LOG_PREFIX, 'renderCardGrid failed', e); }
            }
            if (editView) editView.style.display = 'none';
        }
    } else {
        const tab = settingsTabs().find(t => t.id === manageState.activeTab);
        if (tab) draw(tab.container, tab.render);
    }
}

/**
 * Every tab that draws settings: its id, what it is called, where it draws, and what draws it.
 *
 * A table rather than a chain of branches, because two things need this and they must not
 * disagree: the dispatcher, which draws the tab you clicked, and the search box, which has
 * to know which page a setting is on before you have ever opened it.
 *
 * Characters is not here. It has no settings and its own two-view arrangement, so it stays
 * a case of its own in renderManageView rather than being bent into this shape.
 */
function settingsTabs() {
    return [
        { id: 'appearance', label: 'Appearance', container: 'sillynpc-appearance-view',
          render: v => renderAppearanceView(v, reprocessAllMessages, updateManageTheme) },
        { id: 'writing', label: 'Writing Rules', container: 'sillynpc-writing-view',
          render: v => renderWritingRulesView(v, reprocessAllMessages) },
        { id: 'goals', label: 'Goals', container: 'sillynpc-goals-view',
          render: v => renderGoalsView(v) },
        { id: 'status', label: 'Tracker', container: 'sillynpc-status-view',
          render: v => renderStatusView(v) },
        { id: 'hud', label: 'HUD', container: 'sillynpc-hud-view',
          render: v => renderHudView(v) },
        { id: 'systems', label: 'Systems', container: 'sillynpc-systems-view',
          render: v => renderSystemsView(v) },
        { id: 'generation', label: 'Generation', container: 'sillynpc-generation-settings-view',
          render: v => renderGenerationSettingsView(v) },
        { id: 'stats', label: 'Stats', container: 'sillynpc-stats-view',
          render: v => renderStatsView(v) },
        { id: 'advanced', label: 'Advanced', container: 'sillynpc-advanced-view',
          render: v => renderAdvancedView(v, {
              applyPopupSize,
              onExport: () => exportData(),
              onImport: () => importData(renderManageView),
          }) },
    ];
}

/** Which half of the Systems tab is showing. */

/**
 * Building a System and managing your Systems, as two views of one tab.
 *
 * They were two tabs sitting next to each other, named so alike that telling them apart
 * meant opening both. They are the same subject seen twice - what a System is made of, and
 * which System you are in - so they read as one page with two views, the way a character's
 * Profile and Edit do.
 *
 * @param {HTMLElement} view
 */
function renderSystemsView(view) {
    view.replaceChildren();

    const tabs = document.createElement('div');
    tabs.className = 'sillynpc-charview-tabs';

    for (const [id, label, hint] of [
        ['builder', 'Builder', 'The stats, collections and fields a System is made of.'],
        ['manager', 'Manager', 'Saving, restoring and switching between whole Systems.'],
    ]) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'sillynpc-charview-tab' + (manageState.systemsView === id ? ' active' : '');
        tab.dataset.view = id;
        tab.textContent = label;
        tab.title = hint;
        tab.addEventListener('click', () => {
            if (manageState.systemsView === id) return;
            manageState.systemsView = id;
            renderSystemsView(view);
        });
        tabs.append(tab);
    }
    view.append(tabs);

    const body = document.createElement('div');
    view.append(body);

    try {
        body.append(manageState.systemsView === 'builder'
            ? buildSystemBuilder(() => renderManageView())
            : buildSystemManager(() => renderManageView()));
    } catch (e) {
        console.error(LOG_PREFIX, `System ${manageState.systemsView} failed`, e);
    }
}


/* ─── Theme Helper ───────────────────────────────────────────────────────── */

/**
 * Updates the extension theme classes on the given root and its parent popup.
 */
function updateManageTheme(root, popupInstance = null) {
    updateExtensionTheme(root, popupInstance);
}

/* ─── Characters Tab ────────────────────────────────────────────────────── */

/**
 * Links every character that has no lorebook entry yet.
 *
 * Auto-sync only ever ran when a character was created from a detected speaker, so
 * anyone added another way, or added before their entry existed, stayed unlinked with no
 * remedy but opening each card in turn.
 */
