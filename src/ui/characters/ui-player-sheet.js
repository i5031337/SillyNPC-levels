import { renderSidebar, renderTabExtras, renderTabContent, commitInlineEdit, commitOpenEdits, playerCollections } from './ui-player-sections.js';
export { commitInlineEdit, commitOpenEdits } from './ui-player-sections.js';
import { debugLog } from '../../core/constants.js';
import { eventSource } from '../../../../../../events.js';
import { getSettings } from '../../core/settings.js';
import { escapeHtml } from '../../core/utils.js';
import { buildPortraitBlock, openLightbox } from './ui-portrait.js';
import { renderLorebookSection, resetLorebookState } from '../story/ui-lorebook-section.js';
import { buildProfileBlocks, renderProfileFields } from './ui-profile.js';
import { readLoreEntry } from '../../characters/character-fill.js';
import { fillCharacter } from './ui-fill.js';
import { renderCollectionUI, attachCollectionListeners, resolveCollectionTarget, persistCollectionEdit } from '../shared/ui-shared.js';
import { buildBulkBar, spliceIndexes } from '../shared/ui-bulk-select.js';
import { choiceOptionsHtml, isChoiceField } from '../shared/ui-shared.js';
import { 
    loadStateFromMetadata,
    applyUpdate,
    getPersonaData,
    getPlayerCard
} from '../../tracker/status-logic.js';

/** 'profile' | 'edit' - the same two the character page has, for the same reason. */
export let currentTab = 'profile';
export let isCollectionEditMode = false;

/**
 * Bulk selection, one handle per collection.
 *
 * It used to be a single handle keyed to whichever collection tab was open. The tabs are
 * gone and every collection is on the page at once, so one handle would put its bar in
 * the first section and route every tick in every list into the same selection.
 *
 * Kept between draws because ticking a box redraws the sheet: a handle built during the
 * draw would forget the tick that caused it.
 *
 * @type {Map<string, object>}
 */
const playerBulks = new Map();

/** @param {string} colId */
export function bulkFor(colId) {
    return playerBulks.get(colId) || null;
}

/** Builds the handle for a collection the first time that collection is drawn. */
function ensureBulk(colId, dom) {
    if (playerBulks.has(colId)) return playerBulks.get(colId);

    const handle = buildBulkBar({
        noun: 'item',
        allIds: () => (loadStateFromMetadata().player?.collections?.[colId] || [])
            .map((_, i) => i),
        onDelete: (ids) => {
            const player = loadStateFromMetadata().player;
            const where = resolveCollectionTarget(player, true);
            const list = where.target?.collections?.[colId];
            if (!list) return;
            // Descending, or the first splice shifts every index chosen after it.
            const removed = spliceIndexes(list, ids);
            persistCollectionEdit(`Dropped ${removed} item(s)`, where, true);
        },
        onRefresh: () => refreshPlayerSheet(dom),
    });
    playerBulks.set(colId, handle);
    return handle;
}

export function openPlayerSheet() {
    return import('../manage/ui-manage.js').then(({ openManagePopup }) => openManagePopup({ tab: 'player' }));
}

/** Render the selected persona in the extension menu. */
export function renderPlayerView(view) {
    // Reads the chat's state and renders it. It used to pull master storage over the live
    // state first - "to avoid race conditions" - which meant looking at your character
    // could change them, and the next save made it permanent.
    const state = loadStateFromMetadata();

    const persona = getPersonaData();
    const settings = getSettings().statusTracker;
    
    debugLog('Rendering player sheet', { persona });

    // Not gated on visible: that now says whether the stat belongs on the in-chat
    // tracker, which has nothing to do with the badge on the sheet.
    const levelStat = settings.playerStats.find(s => s.name === 'Level' || s.name === 'LvL');
    const levelValue = levelStat ? (state.player.stats[levelStat.name] || levelStat.defaultValue || '1') : null;

    const sheetHtml = `
        <div class="sillynpc-player-sheet">
            <div class="sillynpc-sheet-header">
                <div class="sillynpc-sheet-title">
                    <span class="persona-name">${escapeHtml(persona.name)}</span>
                    ${levelValue !== null ? `<div class="level-badge">Lvl ${escapeHtml(levelValue)}</div>` : ''}
                </div>
                <button type="button" class="menu_button sillynpc-sheet-fill" title="Read the story for who you are, a lore entry, your fields and a portrait - filling only what is still empty."><i class="fa-solid fa-fill-drip"></i> <span>Fill</span></button>
            </div>
            <div class="sillynpc-sheet-body">
                <div class="sillynpc-sheet-sidebar"></div>
                <div class="sillynpc-sheet-main">
                    <div class="sillynpc-charview-tabs">
                        <button type="button" class="sillynpc-charview-tab ${currentTab === 'profile' ? 'active' : ''}" data-view="profile">Profile</button>
                        <button type="button" class="sillynpc-charview-tab ${currentTab === 'edit' ? 'active' : ''}" data-view="edit">Edit</button>
                    </div>
                    <div class="sillynpc-sheet-content">
                        ${renderTabContent(currentTab, state)}
                    </div>
                </div>
            </div>
        </div>
    `;

    view.innerHTML = sheetHtml;
    // The lorebook block is shared with the character editor, and its mode is module
    // state - a picker left open there would otherwise open here against the player.
    resetLorebookState();
    renderSidebar(view);
    renderTabExtras(view);
    attachSheetListeners(view);
}

/**
 * The left column: the player's portrait.
 *
 * Read-only on Profile and the full block on Edit, the same split the character page
 * makes - looking at somebody and changing them are different jobs and the controls
 * belong with the second one.
 *
 * Redrawn on its own rather than through refreshPlayerSheet, which only replaces the tab
 * content: generating a portrait has to show here.
 *
 * @param {HTMLElement} dom
 */
function attachSheetListeners(dom) {
    // Tab switching
    dom.querySelectorAll('.sillynpc-charview-tab').forEach(tab => {
        if (tab.dataset.listenerAttached) return;
        tab.addEventListener('click', () => {
            if (currentTab === tab.dataset.view) return;
            currentTab = tab.dataset.view;
            refreshPlayerSheet(dom);
            // The portrait differs between the two: read-only on Profile, the full block
            // with its controls on Edit.
            renderSidebar(dom);
        });
        tab.dataset.listenerAttached = 'true';
    });

    dom.querySelectorAll('.sillynpc-inline-choice').forEach(el => {
        if (el.dataset.listenerAttached) return;
        el.addEventListener('change', () => {
            applyUpdate({ player: { stats: { [el.dataset.stat]: el.value } } },
                { verbatim: true });
        });
        el.dataset.listenerAttached = 'true';
    });

    // Inline Editing
    dom.querySelectorAll('.sillynpc-inline-edit').forEach(el => {
        if (el.dataset.listenerAttached) return;
        el.addEventListener('blur', () => {
            if (commitInlineEdit(el)) refreshPlayerHeader(dom);
        });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
        });
        el.dataset.listenerAttached = 'true';
    });

    const state = loadStateFromMetadata();

    // Scoped to its own section, so each collection's Add, its checkboxes and its bulk
    // bar reach only its own list. Handed the whole sheet they would all bind to the
    // first section on the page.
    for (const col of playerCollections()) {
        const section = dom.querySelector(`[data-col-section="${col.id}"]`);
        if (!section) continue;
        attachCollectionListeners(section, state.player, () => refreshPlayerSheet(dom),
            ensureBulk(col.id, dom));
    }

    dom.querySelectorAll('.sillynpc-edit-toggle').forEach(btn => {
        if (btn.dataset.listenerAttached) return;
        btn.addEventListener('click', () => {
            isCollectionEditMode = !isCollectionEditMode;
            refreshPlayerSheet(dom);
        });
        btn.dataset.listenerAttached = 'true';
    });

    const fillBtn = dom.querySelector('.sillynpc-sheet-fill');
    if (fillBtn && !fillBtn.dataset.listenerAttached) {
        fillBtn.addEventListener('click', () => {
            fillCharacter(getPlayerCard(), {
                onSave: () => {
                    renderSidebar(dom);
                    refreshPlayerSheet(dom);
                    // A portrait or a new set of stats both show outside this popup.
                    eventSource.emit('sillynpc-player-portrait-changed');
                },
            });
        });
        fillBtn.dataset.listenerAttached = 'true';
    }

}

export function refreshPlayerSheet(dom) {
    /* Anything still being typed is written before the markup holding it is thrown away.
       This is the other way an edit was being lost, and the one that needs no closing at
       all: switching tabs replaces the sheet's contents, and a field replaced mid-edit
       takes its value with it. Relying on blur to have fired first is relying on the
       browser having moved focus before the click handler ran, which is a race this does
       not need to enter. */
    commitOpenEdits(dom);

    const state = loadStateFromMetadata();
    refreshPlayerHeader(dom, state);

    // Refresh only for actions such as adding items or switching tabs, so an
    // active input keeps its focus while the user types.
    const content = dom.querySelector('.sillynpc-sheet-content');
    content.innerHTML = renderTabContent(currentTab, state);
    
    // The tabs were renamed to the character page's when the sheet was rebuilt, and this
    // was left reading the old class and the old attribute - so it matched nothing and
    // Edit never lit up.
    dom.querySelectorAll('.sillynpc-charview-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.view === currentTab);
    });
    
    renderTabExtras(dom);
    attachSheetListeners(dom);
}

function refreshPlayerHeader(dom, state = loadStateFromMetadata()) {
    const name = dom.querySelector('.sillynpc-sheet-title .persona-name');
    if (name) name.textContent = getPersonaData().name;
    const badge = dom.querySelector('.sillynpc-sheet-title .level-badge');
    const levelStat = getSettings().statusTracker.playerStats.find(s => s.name === 'Level' || s.name === 'LvL');
    if (badge && levelStat) badge.textContent = `Lvl ${state.player.stats[levelStat.name] || levelStat.defaultValue || '1'}`;
}
