import { debugLog } from './constants.js';
import { eventSource } from '../../../../events.js';
import { getSettings } from './settings.js';
import { escapeHtml } from './utils.js';
import { buildPortraitBlock, openLightbox } from './ui-portrait.js';
import { renderLorebookSection } from './ui-lorebook-section.js';
import { buildProfileBlocks, renderProfileFields } from './ui-profile.js';
import { readLoreEntry } from './character-fill.js';
import { renderCollectionUI, choiceOptionsHtml, isChoiceField } from './ui-shared.js';
import { applyUpdate, getPlayerCard } from './status-logic.js';
import { currentTab, isCollectionEditMode, bulkFor, refreshModal } from './ui-player-modal.js';

export function renderSidebar(dom) {
    const sidebar = dom.querySelector('.sillynpc-sheet-sidebar');
    if (!sidebar) return;

    const card = getPlayerCard();
    sidebar.replaceChildren();

    if (currentTab === 'edit') {
        const { preview, buttons } = buildPortraitBlock(card, {
            onChange: () => {
                renderSidebar(dom);
                // The same face is on the HUD and beside every message the player has sent,
                // and neither redraws itself. Announced rather than called: this module cannot
                // reach the HUD without closing an import loop, and index.js already owns the
                // list of things a change like this has to repaint.
                eventSource.emit('sillynpc-player-portrait-changed');
            },
        });
        sidebar.append(preview, buttons);
        return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-cv-portrait';
    if (card.imageUrl) {
        const img = document.createElement('img');
        img.src = card.imageUrl;
        img.alt = card.name || '';
        img.title = 'Click to view full size';
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => openLightbox(card.imageUrl));
        wrap.append(img);
    } else {
        const empty = document.createElement('div');
        empty.className = 'sillynpc-cv-portrait-empty';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-user-large';
        const text = document.createElement('span');
        text.textContent = 'no image';
        empty.append(icon, text);
        wrap.append(empty);
    }
    sidebar.append(wrap);
}

/**
 * The parts of a tab that build elements rather than markup: the profile fields, and the
 * lore. renderTabContent hands back a string, and both of these need real nodes - the
 * lore because it is loaded over an await.
 *
 * @param {HTMLElement} dom
 */
export function renderTabExtras(dom) {
    const card = getPlayerCard();

    const readOnly = dom.querySelector('.sillynpc-sheet-content .sillynpc-sheet-profile');
    if (readOnly) {
        const blocks = buildProfileBlocks(card);
        if (blocks.length) {
            readOnly.replaceChildren(...blocks);
        } else {
            const empty = document.createElement('p');
            empty.className = 'notes sillynpc-cv-empty';
            empty.textContent = 'Nothing recorded about who you are yet. Open Edit and '
                + 'write it, and the reader will be told it as established fact.';
            readOnly.replaceChildren(empty);
        }
    }

    const form = dom.querySelector('.sillynpc-sheet-content .sillynpc-sheet-profile-form');
    if (form) renderProfileFields(card, form);

    const loreView = dom.querySelector('.sillynpc-sheet-content .sillynpc-sheet-lore');
    if (loreView) {
        loreView.replaceChildren();
        if (card.lorebook?.world) {
            readLoreEntry(card).then(text => {
                if (!text) return;
                const heading = document.createElement('div');
                heading.className = 'sillynpc-cv-label';
                heading.textContent = `Lore · ${card.lorebook.world}`;
                const body = document.createElement('div');
                body.className = 'sillynpc-cv-lore-text';
                body.textContent = text;
                loreView.append(heading, body);
            }).catch(err => console.error('[SillyNPC] player lore read failed', err));
        }
    }

    const loreEdit = dom.querySelector('.sillynpc-sheet-content .lorebook-section-container');
    if (loreEdit) {
        renderLorebookSection(card, loreEdit, { onChange: () => refreshModal(dom) })
            .catch(err => console.error('[SillyNPC] player lorebook section failed', err));
    }
}

/** The collections a player can hold anything in. */
export function playerCollections() {
    return (getSettings().statusTracker.collections || [])
        .filter(col => col.target === 'player' || col.target === 'all');
}

/** One collection under its own heading, however the tab wants it drawn. */
function collectionSection(col, state, settings, options) {
    return `
        <div class="sillynpc-sheet-section" data-col-section="${escapeHtml(col.id)}">
            <div class="sillynpc-cv-label">${escapeHtml(col.name || col.id)}</div>
            ${renderCollectionUI(col.id, state.player, settings, options)}
        </div>
    `;
}

/**
 * Writes one hand-edited stat back, if it was edited.
 *
 * Blur alone was losing them. A field still holding the caret when the sheet closes is
 * removed from the document rather than blurred, and a removed element fires no blur
 * event - so the last thing anybody typed before pressing the X was the one thing that
 * never got saved. See commitOpenEdits, which is the other half.
 *
 * What counts as edited is what the field says now against what was rendered into it,
 * carried on the element as data-initial. Not an `input` listener setting a flag, which
 * was the first attempt: that makes saving depend on an event firing, and the failure
 * when it does not is silent and total - nothing is ever marked, so nothing is ever
 * saved. Comparing the text needs nothing to have happened. It also gets the case of a
 * value typed and then typed back right, which is not a change and should not be a line
 * in the timeline.
 *
 * @param {HTMLElement} el A .sillynpc-inline-edit span.
 * @param {Function} [write] The writer, injectable because this cannot be watched
 *   otherwise: applyUpdate reaches chat metadata, which does not exist outside a chat, so
 *   a test of the real one can only observe it refusing.
 * @returns {boolean} Whether anything was written.
 */
export function commitInlineEdit(el, write = applyUpdate) {
    if (!el?.dataset?.stat) return false;

    const value = String(el.innerText ?? '').trim();
    if (value === String(el.dataset.initial ?? '')) return false;

    // Before the write, so this is idempotent: the closing handler can run twice - popup.js
    // says so about the cancel event - and the second run must not add a second line to the
    // timeline saying what the first one said.
    el.dataset.initial = value;

    write(
        { player: { stats: { [el.dataset.stat]: value } } },
        /* Not the default label. These are somebody's own corrections, and a timeline that
           files them under "AI update" is a timeline that cannot be read.

           verbatim because this is the whole value, not a reading of part of one. Without
           it a stat already holding "120/120" answers a typed "120" with "120/120" again -
           the ceiling could be changed but never removed. */
        { label: 'Edited on the sheet', verbatim: true },
    );
    return true;
}

/**
 * Saves whatever is still being typed, before the sheet goes away.
 *
 * Called from the popup's onClosing, which runs on every route out - the X, the settings
 * button, Escape, the backdrop - and while the fields are still in the document. Nothing
 * is written for a field that was not touched.
 *
 * @param {HTMLElement} dlg The popup's dialog.
 * @param {Function} [write] See commitInlineEdit.
 * @returns {number} How many were saved.
 */
export function commitOpenEdits(dlg, write = applyUpdate) {
    if (!dlg) return 0;
    let saved = 0;
    for (const el of dlg.querySelectorAll('.sillynpc-inline-edit')) {
        if (commitInlineEdit(el, write)) saved += 1;
    }
    if (saved) debugLog(`Saved ${saved} stat${saved === 1 ? '' : 's'} still being edited`);
    return saved;
}

export function renderTabContent(tabId, state) {
    const settings = getSettings().statusTracker;

    if (tabId === 'profile') {
        return `
            <div class="sillynpc-attributes-grid">
                ${settings.playerStats.map(statDef => {
                    const actualKey = Object.keys(state.player.stats || {}).find(k => k.toLowerCase() === statDef.name.toLowerCase()) || statDef.name;
                    const value = state.player.stats[actualKey] || statDef.defaultValue || '';
                    // A field with a fixed vocabulary is chosen, not typed. Free typing
                    // would still be refused on the way in, but being told no after the
                    // fact is a worse answer than not being offered the chance.
                    const control = isChoiceField(statDef)
                        ? `<select class="attr-value sillynpc-inline-choice text_pole" data-stat="${escapeHtml(actualKey)}">`
                            + `${choiceOptionsHtml(statDef.options, value)}</select>`
                        : `<span class="attr-value sillynpc-inline-edit" data-stat="${escapeHtml(actualKey)}"`
                            // What was rendered, so the committer can tell an edit from a field
                            // nobody touched without an event having to fire.
                            + ` data-initial="${escapeHtml(value)}" contenteditable="true">${escapeHtml(value)}</span>`;
                    return `
                        <div class="sillynpc-attribute-item">
                            <span class="attr-name">${escapeHtml(statDef.name)}</span>
                            ${control}
                        </div>
                    `;
                }).join('')}
            </div>
            <div class="sillynpc-sheet-profile"></div>
            ${playerCollections().map(col => collectionSection(col, state, settings, {
                isEditMode: false, showEditToggle: false,
            })).join('')}
            <div class="sillynpc-sheet-lore"></div>
        `;
    }

    // Edit. The stats are not repeated here: they are click-to-edit on Profile already,
    // and the one number somebody opens this sheet to fix should not be a tab away.
    return `
        <div class="sillynpc-sheet-profile-form"></div>
        ${playerCollections().map(col => collectionSection(col, state, settings, {
            isEditMode: isCollectionEditMode, showEditToggle: true, bulk: bulkFor(col.id),
        })).join('')}
        <div class="lorebook-section-container"></div>
    `;
}

