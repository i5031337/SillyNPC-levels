"""Quantity editor and arithmetic check with isolated, unsaved fixtures."""
import json
import time
from ui_webdriver import browser_session

with browser_session() as browser:
    browser.execute(r"""
        const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
        const script = document.createElement('script');
        script.type = 'module'; script.id = 'sillynpc-quantity-check';
        script.textContent = `
            const root = ${JSON.stringify(new URL('.', entry.src).href)};
            const host = document.createElement('div');
            host.className = 'sillynpc-system-builder'; document.body.append(host);
            let result;
            try {
                const { buildCollectionsEditor } = await import(root + 'src/ui/system/ui-system-collections.js');
                const { normalizeSystemDefinition } = await import(root + 'src/core/system-schema.js');
                const { collectionQuantityField } = await import(root + 'src/core/collection-fields.js');
                const col = normalizeSystemDefinition({ collections: [{ id: 'inventory', name: 'Inventory',
                    trackQuantity: true, targets: ['player'], fields: [{ name: 'name', isPrimary: true }] }] }).collections[0];
                const settings = { statusTracker: { collections: [col] } };
                let saves = 0;
                const context = { getSettings: () => settings, saveSettings: () => saves++,
                    bulkBars: new Map(), definition: () => ({ npcTemplates: [] }), renameCollectionId() {}, renameCollectionField() {} };
                host.append(buildCollectionsEditor(() => {}, context));
                const check = host.querySelector('.col-quantity');
                const row = [...host.querySelectorAll('.sillynpc-collection-field-row')].find(row => row.querySelector('.f-name').value === 'quantity');
                if (!check.checked || !row || [...row.querySelectorAll('input, select, button')].some(control => !control.disabled))
                    throw Error('Built-in quantity controls');
                check.click();
                if (col.trackQuantity || collectionQuantityField(col) || col.fields.some(field => field.name === 'quantity'))
                    throw Error('Disable quantity');
                check.click();
                if (!col.trackQuantity || collectionQuantityField(col)?.defaultValue !== '1') throw Error('Enable quantity');
                const runtimeUrl = root + 'src/tracker/status-collection-updates.js';
                let source = await (await fetch(runtimeUrl)).text();
                source = source.replace(/import [{] getSettings [}] from '[^']+';/, 'const getSettings = () => fixtureSettings;');
                source = 'let fixtureSettings; export function installFixture(value) { fixtureSettings = value; }\\n' + source;
                source = source.replace(/from '([^']+)'/g, (match, path) => "from '" + new URL(path, runtimeUrl).href + "'");
                const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
                try {
                    const { bind, installFixture } = await import(url);
                    installFixture(settings);
                    const deps = { committedState: {}, getCurrentPersonaName: () => 'Player', constrainToDefinition: (_field, value) => value };
                    bind(deps);
                    const actor = { name: 'Player', collections: {} };
                    deps.applyCollectionUpdate(actor, 'inventory', { add: [{ name: 'Potion', quantity: 2 }] }, { dryRun: true });
                    deps.applyCollectionUpdate(actor, 'inventory', { add: [{ name: 'Potion', quantity: 2 }] }, { dryRun: true });
                    deps.applyCollectionUpdate(actor, 'inventory', { remove: [{ name: 'Potion', quantity: 1 }] }, { dryRun: true });
                    if (actor.collections.inventory[0]?.quantity !== 3) throw Error('Stack arithmetic');
                    deps.applyCollectionUpdate(actor, 'inventory', { remove: [{ name: 'Potion', all: true }] }, { dryRun: true });
                    if (actor.collections.inventory.length) throw Error('Whole stack');
                    result = { option: true, reservedField: true, toggle: true, arithmetic: true, wholeStack: true, fixtureSaves: saves };
                } finally { URL.revokeObjectURL(url); }
            } catch (error) { result = { error: error.stack || String(error) }; }
            finally { host.remove(); document.documentElement.setAttribute('data-quantity-check', JSON.stringify(result)); }
        `;
        document.body.append(script);
    """)
    result = None
    for _ in range(120):
        raw = browser.execute("return document.documentElement.getAttribute('data-quantity-check');")
        if raw:
            result = json.loads(raw)
            break
        time.sleep(0.25)
    browser.execute("document.getElementById('sillynpc-quantity-check')?.remove(); document.documentElement.removeAttribute('data-quantity-check');")
    if result is None or 'error' in result:
        raise RuntimeError(json.dumps(result))
    print('SillyNPC quantity UI passed:', json.dumps(result))
