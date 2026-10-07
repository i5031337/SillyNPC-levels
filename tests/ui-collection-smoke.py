"""Collection editor interaction check in Firefox, with isolated persistence fixtures."""
import json
import time
from ui_webdriver import browser_session

with browser_session() as browser:
    browser.execute(r"""
        const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
        const script = document.createElement('script');
        script.type = 'module'; script.id = 'sillynpc-collection-smoke';
        script.textContent = `
            const root = ${JSON.stringify(new URL('.', entry.src).href)};
            const { bind } = await import(root + 'src/tracker/status-collection-updates.js');
            const { getSettings } = await import(root + 'src/core/settings.js');
            const { renderTabContent } = await import(root + 'src/ui/characters/ui-player-sections.js');
            const source = await (await fetch(root + 'src/ui/collections/ui-collection.js')).text();
            const manageSource = await (await fetch(root + 'src/ui/manage/ui-manage.js')).text();
            const npcSource = await (await fetch(root + 'src/ui/manage/ui-manage-collections.js')).text();
            const strip = text => text.replace(/^import\\s+[\\s\\S]*?\\s+from\\s+['"][^'"]+['"];\\s*/gm, '')
                .replaceAll('export function ', 'function ');
            const col = { id: 'smoke', name: 'Inventory', targets: ['player', 'npc'], fields: [
                { name: 'title', type: 'text', isPrimary: true },
                { name: 'quantity', type: 'number', defaultValue: 1 },
                { name: 'equipped', type: 'boolean', defaultValue: 'false' }
            ] };
            const settings = { statusTracker: { collections: [col] } };
            const state = { player: { name: 'Smoke Player', stats: {}, collections: {} },
                characters: [{ name: 'Smoke NPC', collections: {} }], recently_deleted: {} };
            const deps = { loadStateFromMetadata: () => state, constrainToDefinition: (field, value) => value };
            bind(deps);
            let writes = 0, confirmations = 0;
            let statusHandler = () => {};
            const events = { emit(type, ...args) {
                if (type === 'sillynpc-status-updated') statusHandler(...args);
            } };
            const html = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
            const popup = { show: { confirm: async () => { confirmations++; return true; } } };
            const api = new Function('constrainNumericStat', 'choiceOptionsHtml', 'isChoiceField',
                'getSettings', 'saveSettings', 'isStaticField', 'loadStateFromMetadata', 'saveStateToMetadata',
                'addItem', 'removeItem', 'updateMasterItem', 'renameMasterItem', 'eventSource', 'escapeHtml', 'Popup',
                strip(source) + '; return { renderCollectionUI, attachCollectionListeners };')(
                    (field, value) => value, () => '', () => false, () => settings, () => writes++,
                    () => false, () => state, () => writes++, deps.addItem, deps.removeItem,
                    () => {}, () => {}, events, html, popup);
            const renderNpc = new Function('collectionAppliesTo', 'Popup', 'getSettings', 'saveSettings',
                'getAllCategories', 'createCategory', 'escapeHtml', 'loadStateFromMetadata',
                'renderCollectionUI', 'attachCollectionListeners',
                strip(npcSource) + '; return renderCollectionsSection;')(
                    () => true, popup, () => settings, () => writes++, () => [], () => {}, html,
                    () => state, api.renderCollectionUI, api.attachCollectionListeners);
            const host = document.createElement('div');
            host.className = 'sillynpc-player-sheet'; document.body.append(host);
            const result = {};
            const actual = getSettings().statusTracker;
            const savedCollections = actual.collections;
            try {
                actual.collections = [col];
                for (const actor of [state.player, state.characters[0], { name: 'Offstage', collections: {} }]) {
                    let section;
                    const draw = () => {
                        // Replace the section as the player sheet does when it refreshes.
                        section = document.createElement('div'); host.replaceChildren(section);
                        section.innerHTML = api.renderCollectionUI('smoke', actor, settings.statusTracker);
                        api.attachCollectionListeners(section, actor, draw);
                        return section;
                    };
                    draw(); section.querySelector('.sillynpc-add-item').click();
                    for (const width of [280, 600]) {
                        host.style.width = width + 'px';
                        const button = section.querySelector('.drop-item');
                        const rect = button.getBoundingClientRect();
                        for (const field of section.querySelectorAll('.item-field-input')) {
                            const box = field.getBoundingClientRect();
                            if (rect.left < box.right && rect.right > box.left
                                && rect.top < box.bottom && rect.bottom > box.top) throw Error('Delete overlaps field');
                        }
                        if (getComputedStyle(button.parentElement).opacity !== '1') throw Error('Delete hidden');
                        if (section.scrollWidth > section.clientWidth + 2) throw Error('Collection overflows');
                    }
                    const first = section.querySelector('[data-field="title"]');
                    if (first !== document.activeElement || first.selectionEnd !== first.value.length) throw Error('Name not focused');
                    if (actor.collections.smoke[0].quantity !== 1 || actor.collections.smoke[0].equipped !== false) throw Error('Defaults');
                    first.value = 'Sword'; first.dispatchEvent(new Event('change'));
                    section.querySelector('.sillynpc-add-item').click();
                    section.querySelector('.sillynpc-add-item').click();
                    if (actor.collections.smoke.map(item => item.title).join(',') !== 'Sword,New Item,New Item 2') throw Error('Add/rename');
                    if (section.querySelector('.sillynpc-bulk-slot,.item-bulk-check,.sillynpc-edit-toggle')) throw Error('Extra controls');
                    if (section.querySelectorAll('button.drop-item').length !== 3) throw Error('Delete buttons');
                    section.querySelector('.drop-item').click();
                    await new Promise(resolve => setTimeout(resolve, 0));
                    if (actor.collections.smoke.length !== 2 || actor.collections.smoke.some(item => item.title === 'Sword')) throw Error('Delete');
                    result[actor.name] = true;
                }
                const listenerSource = manageSource.slice(
                    manageSource.indexOf('export function refreshManageOnStatusUpdate'),
                    manageSource.indexOf("eventSource.on('sillynpc-status-updated', refreshManageOnStatusUpdate)"));
                let redraws = 0;
                statusHandler = new Function('manageState', 'renderManageView',
                    listenerSource.replace('export function ', 'function ')
                    + '; return refreshManageOnStatusUpdate;')(
                        { manageRoot: host, activeTab: 'player' }, () => redraws++);
                host.style.height = '220px'; host.style.overflow = 'auto';
                host.innerHTML = '<div style="height:600px"></div>'
                    + api.renderCollectionUI('smoke', state.player, settings.statusTracker)
                    + '<div style="height:400px"></div>';
                api.attachCollectionListeners(host, state.player);
                host.scrollTop = 500;
                const numeric = host.querySelector('[data-field="quantity"]');
                const scrollBefore = host.scrollTop;
                document.activeElement?.blur();
                for (let i = 0; i < 3; i++) {
                    numeric.value = String(Number(numeric.value) + 1);
                    numeric.dispatchEvent(new Event('input', { bubbles: true }));
                    numeric.dispatchEvent(new Event('change', { bubbles: true }));
                }
                result.numericScroll = scrollBefore > 0 && host.scrollTop === scrollBefore && redraws === 0
                    && numeric.isConnected && state.player.collections.smoke[0].quantity === 4;
                statusHandler(state);
                result.externalUpdatesRefresh = redraws === 1;
                statusHandler = () => {};
                host.style.height = ''; host.style.overflow = '';
                const card = { name: 'Stored NPC', statusCollections: { smoke: [{ title: 'Card Sword' }] } };
                renderNpc(card, host);
                if (!host.querySelector('.item-field-input') || host.textContent.includes('Edit stored collections')) throw Error('Offstage gate');
                host.querySelector('.sillynpc-add-item').click();
                if (card.statusCollections.smoke.length !== 2) throw Error('Card persistence');
                result.offstageEditor = true;
                const edit = renderTabContent('edit', state);
                const profile = renderTabContent('profile', state);
                result.playerTabs = edit.includes('sillynpc-add-item') && edit.includes('drop-item')
                    && !edit.includes('sillynpc-edit-toggle') && !profile.includes('drop-item')
                    && !profile.includes('sillynpc-add-item');
                result.deletionConfirmationsOnly = confirmations === 3;
                result.persistence = writes > 0;
            } catch (error) { result.error = String(error); }
            finally { actual.collections = savedCollections; host.remove(); }
            document.documentElement.setAttribute('data-collection-smoke', JSON.stringify(result));
        `;
        document.head.append(script);
    """)
    result = None
    for _ in range(80):
        raw = browser.execute("return document.documentElement.getAttribute('data-collection-smoke')")
        if raw:
            result = json.loads(raw)
            break
        time.sleep(0.25)
    browser.execute("""document.querySelector('#sillynpc-collection-smoke')?.remove();
        document.documentElement.removeAttribute('data-collection-smoke');""")
    assert result and 'error' not in result and all(result.values()), result
    print('Collection editor passed:', json.dumps(result))
