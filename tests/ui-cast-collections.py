"""Unsaved live regression for Cast profiles and collection tab switching."""
import json
import time
from ui_webdriver import browser_session

with browser_session() as browser:
    execute = browser.execute
    execute("document.querySelector('#sillynpc-open-manage').click()")
    execute("""const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
      const script = document.createElement('script');
      script.type = 'module'; script.id = 'sillynpc-cast-collections-smoke';
      script.textContent = `
        const root = ${JSON.stringify(new URL('.', entry.src).href)};
        let result = {};
        try {
          const { getSettings } = await import(root + 'src/core/settings.js');
          const { renderProfileView } = await import(root + 'src/ui/characters/ui-profile.js');
          const { renderCollectionsSection } = await import(root + 'src/ui/manage/ui-manage-collections.js');
          const settings = getSettings().statusTracker;
          const savedCollections = settings.collections;
          const host = document.createElement('div');
          host.className = 'sillynpc sillynpc-manage'; document.body.append(host);
          try {
            settings.collections = [
              { id: 'fixture_inventory', name: 'Fixture Inventory', targets: ['npc'],
                fields: [{ name: 'name', isPrimary: true, type: 'text' }] },
              { id: 'fixture_skills', name: 'Fixture Skills', targets: ['npc'], showInTracker: false,
                fields: [{ name: 'skill', isPrimary: true, type: 'text' }] },
              { id: 'fixture_spells', name: 'Fixture Spells', targets: ['npc'],
                fields: [{ name: 'spell', isPrimary: true, type: 'text' }] },
            ];
            const char = { name: '__Cast collection fixture__', profile: {}, aliases: [],
              statusCollections: { fixture_inventory: [{ name: 'Fixture Sword' }],
                fixture_skills: [{ skill: 'Fixture Stealth', name: 'Wrong identifier' }],
                fixture_spells: [{ spell: 'Fixture Fireball' }] } };
            const profile = document.createElement('div'); host.append(profile);
            await renderProfileView(char, profile);
            const labels = [...profile.querySelectorAll('.sillynpc-cv-label')].map(el => el.textContent);
            result.allHeadings = settings.collections.every(col => labels.includes(col.name));
            result.allItems = ['Fixture Sword', 'Fixture Stealth', 'Fixture Fireball']
              .every(name => profile.textContent.includes(name));
            result.primaryIdentifier = !profile.textContent.includes('Wrong identifier');
            const editor = document.createElement('div'); host.append(editor);
            renderCollectionsSection(char, editor);
            const tabs = [...editor.querySelectorAll('.sillynpc-npc-collections-tabs .sillynpc-tab')];
            result.tabs = tabs.length;
            result.switching = tabs.every((tab, i) => {
              tab.click();
              return tab.classList.contains('active')
                && editor.querySelector('.item-field-input').value ===
                  ['Fixture Sword', 'Fixture Stealth', 'Fixture Fireball'][i];
            });
          } finally { settings.collections = savedCollections; host.remove(); }
        } catch (error) { result.error = String(error); }
        document.documentElement.setAttribute('data-cast-collections-smoke', JSON.stringify(result));
      `;
      document.head.append(script);""")
    result = None
    try:
        for _ in range(80):
            raw = execute("return document.documentElement.getAttribute('data-cast-collections-smoke')")
            if raw:
                result = json.loads(raw)
                break
            time.sleep(0.25)
    finally:
        execute("""document.querySelector('#sillynpc-cast-collections-smoke')?.remove();
          document.documentElement.removeAttribute('data-cast-collections-smoke');""")
    assert result and not result.get('error'), result
    assert result['tabs'] == 3 and result['switching'], result
    assert all(result[key] for key in ['allHeadings', 'allItems', 'primaryIdentifier']), result
    print('Cast collections passed:', json.dumps(result))
