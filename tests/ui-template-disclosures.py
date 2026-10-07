"""Read-only regression check for NPC template disclosure state and headings."""
import json
import time
from ui_webdriver import browser_session


with browser_session() as browser:
    execute = browser.execute
    execute("""
      const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
      const script = document.createElement('script');
      script.type = 'module'; script.id = 'template-disclosure-check';
      script.textContent = `
        const host = document.createElement('div'); document.body.append(host);
        try {
          const root = ${JSON.stringify(new URL('.', entry.src).href)};
          const { buildSystemBuilder } = await import(root + 'src/ui/system/ui-system-builder.js');
          const { normalizeSystemDefinition } = await import(root + 'src/core/system-schema.js');
          const definition = normalizeSystemDefinition({ name: 'Disclosure fixture',
            profiles: { npc: [{ id: 'species', label: 'Species' }] },
            stats: { npc: [{ id: 'hp', name: 'HP', type: 'number', defaultValue: '10' }] },
            npcTemplates: ['human', 'creature', 'robot'].map(id => ({ id, name: id, profileIds: [], statIds: ['hp'] })) });
          const settings = { activeSystem: 'Disclosure fixture', statusTracker: {
            npcStats: definition.stats.npc, progression: {} } };
          let saves = 0;
          const context = { getSettings: () => settings, saveSettings: () => { saves++; },
            definition: () => definition, builderActiveTab: 'npc-templates' };
          const render = () => host.replaceChildren(buildSystemBuilder(render, context));
          const sections = () => [...host.querySelectorAll('details[data-template-id]')];
          const states = () => sections().map(section => section.open);
          const check = (selector) => sections()[0].querySelector(selector).click();
          render();
          const profileId = definition.profiles.npc[0].id;
          const initialProfileSelection = definition.npcTemplates[0].profileIds.includes(profileId);
          sections()[1].querySelector('summary').click();
          sections()[2].querySelector('summary').click();
          // Click immediately, before the queued native toggle events are delivered.
          check('fieldset:not(.sillynpc-progression-editor) input[type=checkbox]');
          const afterProfile = states();
          check('fieldset:nth-of-type(2) input[type=checkbox]');
          const afterStat = states();
          check('[aria-label="Enable level progression"]');
          const afterProgression = states();
          const heading = sections()[0].querySelector('summary');
          const headingStyle = getComputedStyle(heading);
          const prominentHeading = Number(headingStyle.fontWeight) >= 700
            && parseFloat(headingStyle.fontSize) > parseFloat(getComputedStyle(sections()[0]).fontSize);
          const storedSelection = definition.npcTemplates[0].profileIds.includes(profileId) !== initialProfileSelection;
          const newName = host.querySelector('[aria-label="New NPC template name"]');
          newName.value = 'Spirit';
          [...host.querySelectorAll('button')].find(button => button.textContent === 'Add template').click();
          const afterAdd = states();
          sections()[3].querySelector('button').click();
          const afterRemove = states();
          document.body.setAttribute('data-template-disclosures', JSON.stringify({
            afterProfile, afterStat, afterProgression, afterAdd, afterRemove,
            prominentHeading, storedSelection, saves }));
        } catch (error) {
          document.body.setAttribute('data-template-disclosures', JSON.stringify({ error: error.stack }));
        } finally { host.remove(); }
      `;
      document.body.append(script);
    """)
    result = None
    try:
        for _ in range(80):
            raw = execute("return document.body.getAttribute('data-template-disclosures')")
            if raw:
                result = json.loads(raw)
                break
            time.sleep(0.1)
    finally:
        execute("document.querySelector('#template-disclosure-check')?.remove(); document.body.removeAttribute('data-template-disclosures')")
    assert result and 'error' not in result, result
    for key in ['afterProfile', 'afterStat', 'afterProgression', 'afterRemove']:
        assert result[key] == [True, False, False], result
    assert result['afterAdd'] == [True, False, False, True], result
    assert result['prominentHeading'] and result['storedSelection'] and result['saves'] == 5, result
    print('NPC template disclosures live UI passed:', json.dumps(result))
