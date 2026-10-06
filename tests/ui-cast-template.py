"""Read-only name-entry regression check in the running SillyTavern page."""
import json
import time
from ui_webdriver import browser_session


with browser_session() as browser:
    browser.execute("""const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
      const script = document.createElement('script'); script.type = 'module'; script.id = 'sillynpc-cast-template-smoke';
      script.textContent = `
        let result;
        const root = ${JSON.stringify(new URL('.', entry.src).href)};
        const { getSettings } = await import(root + 'src/core/settings.js');
        const { normalizeSystemDefinition } = await import(root + 'src/core/system-schema.js');
        const { assignMatchingTrackerTemplate } = await import(root + 'src/characters/characters.js');
        const { buildNpcTemplateSelect } = await import(root + 'src/ui/characters/ui-npc-template.js');
        const { renderProfileFields } = await import(root + 'src/ui/characters/ui-profile.js');
        const { Popup } = await import(new URL('../../../popup.js', root).href);
        const { buildStatusHtml } = await import(root + 'src/tracker/ui/status-ui-template.js');
        const settings = getSettings();
        const active = settings.activeSystem, tracker = settings.statusTracker;
        const savedCharacters = settings.characters;
        const host = document.createElement('div'); document.body.append(host);
        try {
          const definition = normalizeSystemDefinition({ schemaVersion: 1,
            profiles: { npc: [{ id: 'occupation', label: 'Occupation' }] },
            stats: { npc: [{ id: 'hp', name: 'HP', type: 'number' }] },
            npcTemplates: [{ id: 'human', name: 'Human', statIds: ['hp'], profileIds: ['occupation'] }] });
          settings.activeSystem = 'Cast fixture';
          settings.statusTracker = { ...tracker, npcStats: definition.stats.npc,
            presets: { 'Cast fixture': { definition } } };
          const state = { characters: [{ name: 'Mira', npcTemplateId: 'human', stats: { HP: '8' } }] };
          // Exercise the actual name field handler with persistence and folder IO stubbed.
          const source = await (await fetch(root + 'src/ui/manage/ui-manage-editor.js')).text();
          const nameFieldSource = source.slice(source.indexOf('function buildEditorNameField('),
            source.indexOf('function renderEditForm('));
          let saves = 0, redraws = 0, refreshes = 0;
          const buildNameField = new Function('document', 'saveSettings', 'assignMatchingTrackerTemplate',
            'triggerReprocess', 'renameLorebookEntry', 'folderFor',
            nameFieldSource + '; return buildEditorNameField;')(document,
              () => saves++, card => assignMatchingTrackerTemplate(card, state),
              () => redraws++, async () => {}, () => '');
          const card = { name: '', npcTemplateId: '', profile: {} };
          const title = document.createElement('h3');
          const fields = document.createElement('div'), selector = document.createElement('div');
          host.append(title, selector, fields);
          const refresh = () => {
            refreshes++;
            selector.replaceChildren(buildNpcTemplateSelect(card, () => {}, state));
            renderProfileFields(card, fields);
          };
          const nameField = buildNameField(card, title, refresh); host.append(nameField);
          const input = nameField.querySelector('input');
          input.value = 'mIRA'; input.dispatchEvent(new Event('input'));
          input.dispatchEvent(new Event('change'));
          result = { template: card.npcTemplateId, selected: selector.querySelector('select')?.value,
            fields: [...fields.querySelectorAll('.sillynpc-profile-label')].map(label => label.textContent.trim()),
            title: title.textContent, saves, redraws, refreshes,
            trackerUnchanged: JSON.stringify(state) === JSON.stringify({ characters: [
              { name: 'Mira', npcTemplateId: 'human', stats: { HP: '8' } }] }) };
          const cardsSource = await (await fetch(root + 'src/ui/manage/ui-manage-cards.js')).text();
          const addSource = cardsSource.slice(cardsSource.indexOf('export function buildAddCard('),
            cardsSource.indexOf('/* ─── Editor View')).replace('export function', 'function');
          const created = [], included = [], opened = [];
          const buildAddCard = new Function('document', 'Popup', 'createCharacter', 'addCharacterToChat',
            addSource + '; return buildAddCard;')(document, Popup, name => {
              const card = { id: 'fixture-npc', name, npcTemplateId: '' };
              assignMatchingTrackerTemplate(card, state); created.push(card); return card;
            }, id => included.push(id));
          const add = buildAddCard(id => opened.push(id)); host.append(add);
          for (const value of [null, '   ', '  mIRA  ']) {
            add.click();
            const popup = Popup.util.popups.at(-1);
            if (!popup?.dlg.textContent.includes('New NPC')) throw new Error('Missing NPC name prompt');
            result.creationsBeforePromptConfirmed = created.length;
            if (value === null) await popup.completeCancelled();
            else { popup.mainInput.value = value; await popup.completeAffirmative(); }
          }
          result.created = created; result.included = included; result.opened = opened;
          settings.characters = [{ id: 'fixture-saved', name: 'Fixture Saved', npcTemplateId: 'human',
            aliases: [{ pattern: 'Fixture Alias', isRegex: false }] }];
          const trackerState = { global: {}, player: { stats: {} }, characters: [
            { name: 'Fixture Silent', npcTemplateId: 'human', stats: { HP: '8' } },
            { name: 'Fixture Saved', npcTemplateId: 'human', stats: {} },
            { name: 'Fixture Alias', npcTemplateId: 'human', stats: {} },
            { name: 'Fixture Unassigned', npcTemplateId: '', stats: {} }] };
          const trackerHost = document.createElement('div'); host.append(trackerHost);
          const renderTracker = portraits => buildStatusHtml(trackerState, {
            ...settings.statusTracker, showGlobalStats: false, showPlayerStats: false, showNpcStats: true,
            showCharacters: true, showNpcPortraits: portraits, collections: [], globalStats: [], playerStats: [],
            template: '<div>{{#characters}}<div class="sillynpc-status-char">👤 {{name}} — {{fields}}</div>{{/characters}}</div>' });
          trackerHost.innerHTML = renderTracker(false);
          const fillButtons = [...trackerHost.querySelectorAll('.sillynpc-char-fill')];
          result.trackerFillNames = fillButtons.map(button => button.dataset.name);
          result.noPersonIcons = !trackerHost.textContent.includes('👤') && !renderTracker(true).includes('👤');
          const editSource = (await (await fetch(root + 'src/tracker/ui/status-ui-edit.js')).text())
            .replace(/^import .*;$/gm, '').replace('export function', 'function');
          let finishFill, fillCalls = [];
          const attach = new Function('fillNewCharacter', editSource + '; return attachInlineEditListeners;')(
            (name, options) => { fillCalls.push(name); return new Promise(resolve => { finishFill = resolve; }); });
          attach(trackerHost);
          fillButtons[0].click(); fillButtons[0].click();
          result.fillBusy = fillButtons[0].disabled;
          finishFill(); await Promise.resolve(); await Promise.resolve();
          result.fillCalls = fillCalls; result.fillReady = !fillButtons[0].disabled;
        } catch (error) { result = { error: error.stack }; }
        finally { settings.activeSystem = active; settings.statusTracker = tracker; settings.characters = savedCharacters; host.remove(); }
        document.body.setAttribute('data-cast-template-smoke', JSON.stringify(result));
      `; document.body.append(script);""")
    result = None
    for _ in range(100):
        raw = browser.execute("return document.body.getAttribute('data-cast-template-smoke')")
        if raw:
            result = json.loads(raw)
            break
        time.sleep(0.1)
    browser.execute("document.querySelector('#sillynpc-cast-template-smoke')?.remove(); document.body.removeAttribute('data-cast-template-smoke')")
    assert result and 'error' not in result, result
    assert result['template'] == result['selected'] == 'human', result
    assert result['fields'] == ['Occupation'] and result['title'] == 'mIRA', result
    assert result['saves'] == 2 and result['redraws'] == result['refreshes'] == 1, result
    assert result['trackerUnchanged'], result
    assert result['creationsBeforePromptConfirmed'] == 0, result
    assert result['created'] == [{'id': 'fixture-npc', 'name': 'mIRA', 'npcTemplateId': 'human'}], result
    assert result['included'] == result['opened'] == ['fixture-npc'], result
    assert result['trackerFillNames'] == ['Fixture Silent', 'Fixture Unassigned'], result
    assert result['noPersonIcons'] and result['fillBusy'] and result['fillReady'], result
    assert result['fillCalls'] == ['Fixture Silent'], result
    print('Cast name/template live UI passed:', json.dumps(result))
