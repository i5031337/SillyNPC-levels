import { collectionAppliesTo } from '../../core/collection-targets.js';
import { Popup } from '../../../../../../popup.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { getAllCategories, createCategory } from '../../characters/characters.js';
import { escapeHtml } from '../../core/utils.js';
import { loadStateFromMetadata } from '../../tracker/status-logic.js';
import { renderCollectionUI, attachCollectionListeners } from '../shared/ui-shared.js';

export function renderCollectionsSection(char, container) {
    if (!container) return;
    
    const settings = getSettings().statusTracker;
    const sceneActor = loadStateFromMetadata()?.characters?.find(actor => actor.name?.toLowerCase() === char.name?.toLowerCase());
    const collections = settings.collections.filter(col => collectionAppliesTo(col, 'npc', sceneActor?.npcTemplateId ? sceneActor : char));
    
    if (collections.length === 0) { container.replaceChildren(); return; }

    container.innerHTML = `
        <div class="sillynpc-aliases-header">
            <label>Current Collections</label>
            <small class="notes">Manage inventory and other collections for this NPC in the current chat.</small>
        </div>
        <div class="sillynpc-npc-collections-tabs sillynpc-sheet-tabs" style="margin-top: 10px;">
            ${collections.map((col, idx) => `
                <div class="sillynpc-tab ${idx === 0 ? 'active' : ''}" data-tab="${escapeHtml(col.id)}">${escapeHtml(col.name)}</div>
            `).join('')}
        </div>
        <div class="sillynpc-npc-collections-content" style="margin-top: 10px;">
            <!-- Collection UI will be rendered here -->
        </div>
    `;

    const contentArea = container.querySelector('.sillynpc-npc-collections-content');
    const tabs = container.querySelectorAll('.sillynpc-tab');
    
    let currentCollectionId = collections[0].id;

    const refreshCollection = () => {
        const state = loadStateFromMetadata();
        const charInState = state.characters.find(c => c.name.toLowerCase() === char.name.toLowerCase());

        // A card-backed actor, shaped like a scene one so the same renderer and listeners
        // work unchanged rather than needing an off-stage variant.
        const actor = charInState || {
            name: char.name,
            npcTemplateId: char.npcTemplateId || '',
            stats: char.statusOverrides || {},
            collections: char.statusCollections || (char.statusCollections = {}),
        };

        contentArea.innerHTML = renderCollectionUI(currentCollectionId, actor, settings);
        attachCollectionListeners(contentArea, actor, refreshCollection);
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentCollectionId = tab.dataset.tab;
            refreshCollection();
        });
    });

    refreshCollection();
}

export function renderCategorySelect(char, container, refreshEditor) {
    if (!container) return;
    container.innerHTML = `<label>Category</label><select class="text_pole category-select"></select>`;
    const select = container.querySelector('select');
    const categories = getAllCategories();
    
    let html = `<option value="">(none)</option>`;
    categories.forEach(cat => html += `<option value="${escapeHtml(cat)}" ${char.category === cat ? 'selected' : ''}>${escapeHtml(cat)}</option>`);
    if (char.category && !categories.includes(char.category)) {
        html += `<option value="${escapeHtml(char.category)}" selected>${escapeHtml(char.category)}</option>`;
    }
    html += `<option value="__new__">+ New category…</option>`;
    select.innerHTML = html;

    select.addEventListener('change', async () => {
        if (select.value === '__new__') {
            const name = (await Popup.show.input('New category', 'Enter a name:'))?.trim();
            if (name) {
                // Into the register as well as onto this character, or the category would
                // last only as long as they stayed in it.
                createCategory(name);
                char.category = name;
                saveSettings();
            }
            refreshEditor();
        } else {
            char.category = select.value; saveSettings();
        }
    });
}
