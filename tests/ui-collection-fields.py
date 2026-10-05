"""Read-only collection field check with fixture saves disabled; requires local SillyTavern."""
import json
import time
from ui_webdriver import browser_session


with browser_session() as browser:
    execute = browser.execute
    execute("""const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
      const script = document.createElement('script'); script.type = 'module'; script.id = 'sillynpc-template-smoke';
      script.textContent = `
        const root = ${JSON.stringify(new URL('.', entry.src).href)};
        const host = document.createElement('div'); host.className = 'sillynpc-system-builder'; host.style.width = '280px'; document.body.append(host);
        let result, moduleUrl, itemModuleUrl;
        try {
          const url = root + 'src/ui/system/ui-collection-fields.js';
          let source = await (await fetch(url)).text();
          source = source.replace(/import [{] saveSettings [}] from '[^']+';/, 'const saveSettings = () => {};');
          source = source.replace(/from '([^']+)'/g, (match, path) => "from '" + new URL(path, url).href + "'");
          moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
          const { renderCollectionFields } = await import(moduleUrl);
          const col = { id: 'fixture-moves', fields: [
            { name: 'pp', type: 'number' }, { name: 'move', type: 'text', isPrimary: true, isStatic: false },
            { name: 'description', type: 'text' }] };
          renderCollectionFields(col, host, () => {}, { saveSettings() {} });
          let identifierAlwaysStatic = true;
          for (const value of ['number', 'boolean', 'text']) {
            const select = host.firstElementChild.querySelector('.f-type');
            select.value = value; select.dispatchEvent(new Event('change'));
            identifierAlwaysStatic &&= col.fields[0].isStatic === true
                && !host.firstElementChild.querySelector('.f-static');
          }
          const numeric = host.children[1];
          const numericOptionsHidden = !numeric.querySelector('.f-options');
          const numericControlsHidden = !numeric.querySelector('.f-multiline') && !numeric.querySelector('.f-static');
          const wrappedRows = [...host.querySelector('.sillynpc-collection-field-row').children].filter(child => !child.hidden).map(child => child.offsetTop);
          const wrapsWithoutOverflow = new Set(wrappedRows).size > 1 && host.scrollWidth <= host.clientWidth;
          numeric.querySelector('.f-min').value = '-2.5'; numeric.querySelector('.f-min').dispatchEvent(new Event('input'));
          numeric.querySelector('.f-max').value = '5.5'; numeric.querySelector('.f-max').dispatchEvent(new Event('input'));
          const savedRange = [col.fields[1].min, col.fields[1].maxStatValue];
          numeric.querySelector('.f-min').value = '6'; numeric.querySelector('.f-min').dispatchEvent(new Event('input'));
          const rangeErrorShown = !numeric.querySelector('.sillynpc-range-error').hidden
              && numeric.querySelector('.f-min').getAttribute('aria-invalid') === 'true';
          numeric.querySelector('.f-min').value = '-2.5'; numeric.querySelector('.f-min').dispatchEvent(new Event('input'));
          const rangeErrorCleared = numeric.querySelector('.sillynpc-range-error').hidden
              && !numeric.querySelector('.f-min').hasAttribute('aria-invalid');
          const type = numeric.querySelector('.f-type'); type.value = 'text'; type.dispatchEvent(new Event('change'));
          const textChoicesShown = !!host.children[1].querySelector('.f-options') && !host.children[1].querySelector('.f-min')
              && !!host.children[1].querySelector('.f-multiline') && !!host.children[1].querySelector('.f-static');
          const options = host.children[1].querySelector('.f-options'); options.value = 'One, Two'; options.dispatchEvent(new Event('change'));
          const back = host.children[1].querySelector('.f-type'); back.value = 'number'; back.dispatchEvent(new Event('change'));
          const rangeRestored = host.children[1].querySelector('.f-min').value === '-2.5'
              && host.children[1].querySelector('.f-max').value === '5.5' && !col.fields[1].options;
          const { normalizeSystemDefinition } = await import(root + 'src/core/system-schema.js');
          const imported = normalizeSystemDefinition({ schemaVersion: 1, collections: [col] }).collections[0];
          const rangeRoundtrip = imported.fields[1].min === '-2.5' && imported.fields[1].maxStatValue === '5.5';
          const itemUrl = root + 'src/ui/collections/ui-collection.js';
          let itemSource = await (await fetch(itemUrl)).text();
          itemSource = itemSource.replace(/import [{] getSettings, saveSettings [}] from '[^']+';/,
            'let fixtureSettings, fixtureState; const getSettings = () => fixtureSettings; const saveSettings = () => {}; export function installFixture(settings, state) { fixtureSettings = settings; fixtureState = state; }');
          itemSource = itemSource.replace(/import [{] loadStateFromMetadata, saveStateToMetadata, addItem, removeItem, updateMasterItem, renameMasterItem [}] from '[^']+';/,
            'const loadStateFromMetadata = () => fixtureState; const saveStateToMetadata = () => {}; const addItem = () => {}; const removeItem = () => {}; const updateMasterItem = () => {}; const renameMasterItem = () => {};');
          itemSource = itemSource.replace(/import [{] eventSource [}] from '[^']+';/, 'const eventSource = { emit() {} };');
          itemSource = itemSource.replace(/from '([^']+)'/g, (match, path) => "from '" + new URL(path, itemUrl).href + "'");
          itemModuleUrl = URL.createObjectURL(new Blob([itemSource], { type: 'text/javascript' }));
          const { renderCollectionUI, attachCollectionListeners, installFixture } = await import(itemModuleUrl);
          const actor = { name: 'Player', collections: { [col.id]: [{ move: 'Thunderbolt', pp: 3 }] } };
          const itemSettings = { collections: [col] };
          installFixture({ statusTracker: itemSettings }, { player: actor, characters: [] });
          const items = document.createElement('div'); host.append(items);
          items.innerHTML = renderCollectionUI(col.id, actor, itemSettings);
          attachCollectionListeners(items, actor, () => {});
          const pp = items.querySelector('[data-field="pp"]');
          pp.value = '99'; pp.dispatchEvent(new Event('change'));
          const manualMaximum = actor.collections[col.id][0].pp;
          pp.value = '-99'; pp.dispatchEvent(new Event('change'));
          const manualMinimum = actor.collections[col.id][0].pp;
          const inputBounds = [pp.min, pp.max]; items.remove();
          const first = host.firstElementChild;
          const initial = {
            identifierAlwaysStatic, numericControlsHidden, wrapsWithoutOverflow, rangeErrorShown, rangeErrorCleared,
            numericOptionsHidden, savedRange, textChoicesShown, rangeRestored, rangeRoundtrip, manualMaximum, manualMinimum, inputBounds,
            keys: col.fields.map(field => field.name),
            toggles: host.querySelectorAll('.f-primary').length,
            identifiers: host.querySelectorAll('.sillynpc-collection-identifier').length,
            primaryDelete: !!first.querySelector('.delete-field-btn'),
            primaryMove: !!first.querySelector('.move-field-up, .move-field-down'),
            secondMoveUpDisabled: host.children[1].querySelector('.move-field-up').disabled,
          };
          host.lastElementChild.querySelector('.move-field-up').click();
          const reordered = col.fields.map(field => field.name);
          while (col.fields.length > 1) host.lastElementChild.querySelector('.delete-field-btn').click();
          result = { ...initial, reordered, finalKeys: col.fields.map(field => field.name),
            finalPrimary: col.fields[0].isPrimary,
            finalDeleteButtons: host.querySelectorAll('.delete-field-btn').length };
        } catch (error) { result = { error: error.stack }; }
        finally { host.remove(); if (moduleUrl) URL.revokeObjectURL(moduleUrl); if (itemModuleUrl) URL.revokeObjectURL(itemModuleUrl); }
        document.body.setAttribute('data-npc-template-smoke', JSON.stringify(result));
      `; document.body.append(script);""")
    result = None
    for _ in range(80):
        raw = execute("return document.body.getAttribute('data-npc-template-smoke')")
        if raw:
            result = json.loads(raw)
            break
        time.sleep(0.1)
    execute("document.querySelector('#sillynpc-template-smoke')?.remove(); document.body.removeAttribute('data-npc-template-smoke')")
    assert result and 'error' not in result, result
    assert result['identifierAlwaysStatic'], result
    assert result['numericControlsHidden'] and result['wrapsWithoutOverflow'], result
    assert result['rangeErrorShown'] and result['rangeErrorCleared'], result
    assert result['numericOptionsHidden'] and result['textChoicesShown'] and result['rangeRestored'] and result['rangeRoundtrip'], result
    assert result['savedRange'] == result['inputBounds'] == ['-2.5', '5.5'], result
    assert result['manualMaximum'] == 5.5 and result['manualMinimum'] == -2.5, result
    assert result['keys'] == ['move', 'pp', 'description'], result
    assert result['toggles'] == 0 and result['identifiers'] == 1, result
    assert not result['primaryDelete'] and not result['primaryMove'], result
    assert result['secondMoveUpDisabled'], result
    assert result['reordered'] == ['move', 'description', 'pp'], result
    assert result['finalKeys'] == ['move'] and result['finalPrimary'] and result['finalDeleteButtons'] == 0, result
    print('Collection identifier live UI passed:', json.dumps(result))
