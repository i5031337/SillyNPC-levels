import { buildProfileSection } from '../characters/ui-profile-sections.js';
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
    const sceneActor = char.isPlayer ? loadStateFromMetadata()?.player
        : loadStateFromMetadata()?.characters?.find(actor => actor.name?.toLowerCase() === char.name?.toLowerCase());
    const collections = settings.collections.filter(col => collectionAppliesTo(col, char.isPlayer ? 'player' : 'npc', sceneActor?.npcTemplateId ? sceneActor : char));
    
    container.replaceChildren();
    for (const col of collections) {
        const collection = buildProfileSection(`collection:${col.id}`, col.name || col.id, { open: true });
        container.append(collection.section);
        const refreshCollection = () => {
            const state = loadStateFromMetadata();
            const charInState = char.isPlayer ? state?.player
                : state?.characters?.find(c => c.name.toLowerCase() === char.name.toLowerCase());
            const actor = charInState ? { ...charInState, isPlayer: Boolean(char.isPlayer) } : {
                name: char.name,
                isPlayer: Boolean(char.isPlayer),
                npcTemplateId: char.npcTemplateId || '',
                stats: char.statusOverrides || {},
                collections: char.statusCollections || (char.statusCollections = {}),
            };
            collection.setTitle(col.name || col.id, (actor.collections?.[col.id] || []).length);
            collection.body.innerHTML = renderCollectionUI(col.id, actor, settings);
            attachCollectionListeners(collection.body, actor, refreshCollection);
        };
        refreshCollection();
    }
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
