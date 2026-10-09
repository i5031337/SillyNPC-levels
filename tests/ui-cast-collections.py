"""Unsaved live regression for Cast profiles and collapsible collection editors."""
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
          const savedSections = localStorage.getItem('sillynpc-profile-sections');
          localStorage.removeItem('sillynpc-profile-sections');
          const { getSettings } = await import(root + 'src/core/settings.js');
          const { renderProfileView } = await import(root + 'src/ui/characters/ui-profile.js');
          const { renderEditor } = await import(root + 'src/ui/manage/ui-manage-editor.js');
          const { manageState } = await import(root + 'src/ui/manage/ui-manage-state.js');
          const { renderCollectionsSection } = await import(root + 'src/ui/manage/ui-manage-collections.js');
          const master = getSettings();
          const settings = master.statusTracker;
          const savedActive = master.activeSystem;
          const savedStats = settings.npcStats;
          const savedCollections = settings.collections;
          const savedCharacters = master.characters;
          const savedManage = { ...manageState };
          const host = document.createElement('div');
          host.className = 'sillynpc sillynpc-manage'; document.body.append(host);
          try {
            master.activeSystem = '';
            settings.npcStats = [{ name: 'HP', type: 'number', defaultValue: '10/10' }];
            settings.collections = [
              { id: 'fixture_inventory', name: 'Fixture Inventory', targets: ['npc'],
                fields: [{ name: 'name', isPrimary: true, type: 'text' }] },
              { id: 'fixture_skills', name: 'Fixture Skills', targets: ['npc'], showInTracker: false,
                fields: [{ name: 'skill', isPrimary: true, type: 'text' }] },
              { id: 'fixture_spells', name: 'Fixture Spells', targets: ['npc'],
                fields: [{ name: 'spell', isPrimary: true, type: 'text' }] },
            ];
            const char = { id: '__cast-collection-fixture__', name: '__Cast collection fixture__', profile: { age: '42', history: 'Fixture backstory' }, aliases: [{ pattern: 'Fixture Alias' }],
              statusOverrides: { HP: '7/10' },
              statusCollections: { fixture_inventory: [{ name: 'Fixture Sword' }],
                fixture_skills: [{ skill: 'Fixture Stealth', name: 'Wrong identifier' }],
                fixture_spells: [{ spell: 'Fixture Fireball' }] } };
            const profile = document.createElement('div'); host.append(profile);
            await renderProfileView(char, profile);
            const labels = [...profile.querySelectorAll('.sillynpc-profile-section > summary')].map(el => el.textContent);
            result.allHeadings = settings.collections.every(col => labels.includes(col.name + ' · 1'));
            result.allItems = ['Fixture Sword', 'Fixture Stealth', 'Fixture Fireball']
              .every(name => profile.textContent.includes(name));
            result.primaryIdentifier = !profile.textContent.includes('Wrong identifier');
            result.order = [...profile.querySelector('.sillynpc-cv-right').children]
              .map(el => el.dataset.sectionKey).join(',') ===
              'stats,collection:fixture_inventory,collection:fixture_skills,collection:fixture_spells,lore,memories';
            result.defaults = [...profile.querySelector('.sillynpc-cv-right').children]
              .every((el, i) => el.open === (i < 4));
            result.identity = profile.querySelector('.sillynpc-cv-left').textContent.includes('42')
              && profile.querySelector('.sillynpc-cv-left').textContent.includes('Fixture Alias')
              && !profile.textContent.includes('At a glance')
              && !profile.textContent.includes('Description & Lore');
            result.archivedClosed = !profile.querySelector('[data-section-key="archived-memories"]').open;
            const lore = profile.querySelector('[data-section-key="lore"]');
            const inventory = profile.querySelector('[data-section-key="collection:fixture_inventory"]');
            lore.querySelector('summary').click(); inventory.querySelector('summary').click();
            await new Promise(resolve => setTimeout(resolve, 100));
            const reopened = document.createElement('div'); host.append(reopened);
            await renderProfileView({ ...char, name: '__Second Cast fixture__' }, reopened);
            result.remembered = reopened.querySelector('[data-section-key="lore"]').open
              && !reopened.querySelector('[data-section-key="collection:fixture_inventory"]').open;
            result.savedChoice = JSON.parse(localStorage.getItem('sillynpc-profile-sections')).lore === true;
            const editor = document.createElement('div'); host.append(editor);
            renderCollectionsSection(char, editor);
            const sections = [...editor.querySelectorAll('details[data-section-key]')];
            result.collections = sections.length;
            result.editItems = sections.every((section, i) =>
              section.querySelector('.item-field-input').value ===
                ['Fixture Sword', 'Fixture Stealth', 'Fixture Fireball'][i]);
            result.editRemembered = !sections[0].open;
            master.characters = [char];
            const editHost = document.createElement('div');
            editHost.innerHTML = '<div id="sillynpc-editor-view"></div>'; host.append(editHost);
            Object.assign(manageState, { manageRoot: editHost, editingCharId: char.id, charView: 'edit' });
            renderEditor(() => {});
            const right = editHost.querySelector('.sillynpc-editor-right');
            result.editOrder = [...right.querySelectorAll('[data-section-key]')]
              .map(section => section.dataset.sectionKey).join(',') ===
              'stats,collection:fixture_inventory,collection:fixture_skills,collection:fixture_spells,lore,memories,archived-memories';
            result.editControls = !!right.querySelector('.override-val-input')
              && right.querySelectorAll('.sillynpc-add-item').length === 3
              && !!right.querySelector('.sillynpc-profile-input')
              && !!right.querySelector('.sillynpc-memory-add')
              && !!right.querySelector('.sillynpc-trigger-level-up')
              && editHost.querySelector('.sillynpc-editor-left .name-input').value === char.name;
            result.editShared = right.querySelector('[data-section-key="lore"]').open
              && !right.querySelector('[data-section-key="collection:fixture_inventory"]').open;
            const statsSection = right.querySelector('[data-section-key="stats"]');
            statsSection.querySelector('summary').click();
            await new Promise(resolve => setTimeout(resolve, 100));
            renderEditor(() => {});
            result.editReopened = !editHost.querySelector('[data-section-key="stats"]').open;

          } finally {
            settings.collections = savedCollections; settings.npcStats = savedStats;
            master.activeSystem = savedActive; master.characters = savedCharacters;
            Object.assign(manageState, savedManage); host.remove();
            await new Promise(resolve => setTimeout(resolve, 100));
            if (savedSections === null) localStorage.removeItem('sillynpc-profile-sections');
            else localStorage.setItem('sillynpc-profile-sections', savedSections);
          }
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
    assert result['collections'] == 3 and result['editItems'] and result['editRemembered'], result
    assert all(result[key] for key in ['allHeadings', 'allItems', 'primaryIdentifier', 'order', 'defaults',
                                               'identity', 'archivedClosed', 'remembered', 'savedChoice',
                                               'editOrder', 'editControls', 'editShared', 'editReopened']), result
    print('Cast collections passed:', json.dumps(result))
