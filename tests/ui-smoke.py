"""Read-only SillyTavern System Builder smoke check; requires a running local server."""
import json
import time
from ui_webdriver import browser_session


with browser_session() as browser:
    execute = browser.execute
    execute("document.querySelector('#sillynpc-open-manage').click()")
    time.sleep(0.5)
    assert execute("return !document.querySelector('.sillynpc-tabs .sillynpc-subtabs')")
    execute("document.querySelector('.sillynpc-subtabs [data-tab=player]').click()")
    assert execute("return !!document.querySelector('#sillynpc-player-view').children.length")
    execute("document.querySelector('.sillynpc-section[data-section=images]').click()")
    assert execute("return !!document.querySelector('#sillynpc-image-settings-view').children.length")
    execute("document.querySelector('.sillynpc-section[data-section=dialogue]').click()")
    assert execute("return !!document.querySelector('#sillynpc-writing-view').children.length")
    execute("document.querySelector('.sillynpc-section[data-section=status]').click()")
    cast_controls = execute("""const panel = document.querySelector('#sillynpc-status-view');
        return {section: [...panel.querySelectorAll('h3')].some(el =>
            el.textContent.trim() === 'Who Is In The Scene'),
          mode: !!panel.querySelector('[data-setting="statusTracker.castMode"]'),
          binding: !!panel.querySelector('[data-setting="statusTracker.sceneBindingStat"]')};""")
    assert cast_controls == {'section': False, 'mode': False, 'binding': False}, cast_controls
    execute("""const entry = [...document.scripts].find(script =>
        script.src.includes('/SillyNPC-XP/index.js'));
        const script = document.createElement('script');
        script.type = 'module'; script.id = 'sillynpc-manual-smoke';
        script.textContent = `
          const root = ${JSON.stringify(new URL('.', entry.src).href)};
          const { getSettings } = await import(root + 'src/core/settings.js');
          const { renderStatusView } = await import(root + 'src/ui/tracker/ui-tracker-settings.js');
          const { refreshReadButton } = await import(root + 'src/ui/tracker/ui-read-button.js');
          const { buildSceneContext } = await import(root + 'src/tracker/status-logic.js');
          const { buildStatusHtml } = await import(root + 'src/tracker/ui/status-ui-template.js');
          const { buildTrackerBox } = await import(root + 'src/tracker/ui/status-ui-box.js');
          const { renderExtractionReport } = await import(root + 'src/tracker/ui/status-ui-report.js');
          const { getExtractionReport } = await import(root + 'src/tracker/extractor/status-extraction-report.js');
          const { defaultTrackerSettings } = await import(root + 'src/core/settings-tracker-defaults.js');
          const { buildCollectionRewardsEditor } = await import(root + 'src/ui/system/ui-collection-rewards.js');
          const { resolveProfileFields } = await import(root + 'src/core/profile-fields.js');
          const { formatLoreContent, parseLoreContent } = await import(root + 'src/lore/lore-format.js');
          const settings = getSettings().statusTracker;
          const keys = ['enabled', 'extractionMode', 'showGlobalStats', 'showPlayerStats',
            'showNpcStats', 'showRawTrackerOutput'];
          const saved = Object.fromEntries(keys.map(key => [key, settings[key]]));
          const chat = SillyTavern.getContext().chat;
          const savedChat = chat.slice();
          const panel = document.querySelector('#sillynpc-status-view');
          const result = {};
          try {
            const rewardCollection = { id: 'smoke-rewards', targets: ['player', 'template:smoke'], fields: [
              { id: 'reward-title', name: 'technique', label: 'Technique', type: 'text', isPrimary: true },
              { id: 'reward-power', name: 'power', label: 'Power', type: 'number', min: '1', maxStatValue: '3' },
              { id: 'reward-equipped', name: 'equipped', type: 'boolean', defaultValue: 'false' }
            ] };
            let rewardSaves = 0;
            const rewardUi = buildCollectionRewardsEditor(rewardCollection, () => rewardSaves++);
            const rewardHost = document.createElement('div');
            rewardHost.style.width = '280px';
            rewardHost.append(rewardUi); document.body.append(rewardHost);
            try {
              const options = rewardUi.querySelector('.col-rewards-options');
              result.rewardsInitiallyHidden = options.hidden;
              const enabled = rewardUi.querySelector('.col-rewards-enabled');
              enabled.click();
              result.rewardsEnabled = !options.hidden && !rewardUi.querySelector('details')
                && rewardCollection.levelUpRewards.enabled;
              const restoredRewards = buildCollectionRewardsEditor(rewardCollection, () => {});
              result.rewardsVisibleOnLoad = !restoredRewards.querySelector('.col-rewards-options').hidden;
              const mode = rewardUi.querySelector('.col-rewards-mode');
              result.rewardsDefaultGuided = mode.value === 'guided'
                && rewardUi.querySelector('.col-rewards-interval').value === '1'
                && rewardUi.querySelector('.col-rewards-guidance').value === '';
              mode.value = 'scheduled'; mode.dispatchEvent(new Event('change'));
              rewardUi.querySelector('.col-rewards-add').click();
              const fields = [...rewardUi.querySelectorAll('.col-reward-field')];
              result.rewardsActualFields = fields.length === 3 && fields[0].dataset.fieldId === 'reward-title'
                && fields[1].type === 'number' && fields[1].min === '1' && fields[1].max === '3'
                && fields[2].tagName === 'SELECT';
              const error = rewardUi.querySelector('.col-reward-errors');
              result.rewardsIdentifierValidation = error.textContent.includes('required');
              fields[0].value = 'Smoke Technique'; fields[0].dispatchEvent(new Event('input'));
              fields[1].value = '4'; fields[1].dispatchEvent(new Event('input'));
              result.rewardsRangeValidation = error.textContent.includes('maximum');
              fields[1].value = '2'; fields[1].dispatchEvent(new Event('input'));
              result.rewardsValidSchedule = error.textContent === ''
                && rewardCollection.levelUpRewards.schedule[0].entry['reward-title'] === 'Smoke Technique'
                && rewardCollection.levelUpRewards.schedule[0].entry['reward-power'] === 2;
              result.rewardsNarrowLayout = rewardHost.scrollWidth <= rewardHost.clientWidth + 2;
              mode.value = 'guided'; mode.dispatchEvent(new Event('change'));
              const interval = rewardUi.querySelector('.col-rewards-interval');
              result.rewardsGuidedControls = interval.value === '1'
                && !!rewardUi.querySelector('.col-rewards-guidance') && !rewardUi.querySelector('.col-reward-row');
              interval.value = '0'; interval.dispatchEvent(new Event('input'));
              result.rewardsIntervalValidation = !interval.checkValidity()
                && rewardCollection.levelUpRewards.interval === 1;
              interval.value = '2'; interval.dispatchEvent(new Event('input'));
              result.rewardsValidInterval = interval.checkValidity() && rewardCollection.levelUpRewards.interval === 2;
              enabled.click();
              result.rewardsDisabled = options.hidden && !rewardCollection.levelUpRewards.enabled && rewardSaves > 0;
            } finally { rewardHost.remove(); }
            const scene = buildSceneContext({ global: {},
              player: { name: 'Smoke Player', stats: {}, collections: {} },
              characters: [{ name: 'Smoke NPC', stats: {}, collections: {} }] });
            result.sceneStatusOnly = scene.includes('[Current Scene Status]')
              && scene.includes('Smoke Player') && scene.includes('Smoke NPC')
              && !scene.includes('Who they are:');
            const fields = resolveProfileFields('player');
            const values = Object.fromEntries(fields.map(field => [field.id, 'Smoke value']));
            const lore = formatLoreContent(values, '', undefined, 'player');
            const parsed = parseLoreContent(lore, { scope: 'player' });
            result.playerLoreFields = fields.every(field => parsed?.[field.id] === 'Smoke value')
              && lore.split(String.fromCharCode(10)).filter(Boolean).length === fields.length;
            settings.enabled = true; settings.extractionMode = 'manual';
            renderStatusView(panel); refreshReadButton(); refreshReadButton();
            result.visibilityControls = keys.slice(2).every(key =>
              panel.querySelector('[data-setting="statusTracker.' + key + '"]')
                ?.closest('details')?.querySelector('summary')?.textContent === 'Customize display');
            const fixture = { global: { Location: 'Smoke World' },
              player: { name: 'Smoke Player', stats: { HP: '17/20' },
                collections: { inventory: [{ name: 'Player Sword', quantity: 1 }] } },
              characters: [{ name: 'Smoke NPC', stats: { HP: '7/10' },
                collections: { inventory: [{ name: 'NPC Shield', quantity: 1 }] } }] };
            const display = structuredClone(defaultTrackerSettings);
            display.showNpcPortraits = false;
            result.visibilityCombinations = true;
            for (let mask = 0; mask < 8; mask++) {
              display.showGlobalStats = !!(mask & 1);
              display.showPlayerStats = !!(mask & 2);
              display.showNpcStats = !!(mask & 4);
              const html = buildStatusHtml(fixture, display);
              result.visibilityCombinations &&= html.includes('Smoke World') === display.showGlobalStats
                && html.includes('17/20') === display.showPlayerStats
                && html.includes('Player Sword') === display.showPlayerStats
                && html.includes('Smoke NPC') === display.showNpcStats
                && html.includes('NPC Shield') === display.showNpcStats
                && (mask !== 0 || html === '');
            }
            display.showGlobalStats = true; display.showNpcStats = true;
            display.showPlayerStats = false;
            display.template = '<div class="sillynpc-status-box">{{globals}} {{player}} {{inventory}}'
              + '<div class="sillynpc-status-characters">{{#characters}}'
              + '<div class="sillynpc-status-char">{{name}} {{fields}} {{inventory}}</div>'
              + '{{/characters}}</div></div>';
            const customHtml = buildStatusHtml(fixture, display);
            result.customCollectionVisibility = !customHtml.includes('Player Sword')
              && customHtml.includes('NPC Shield');
            const sceneBefore = buildSceneContext(fixture);
            Object.assign(settings, { showGlobalStats: false, showPlayerStats: false, showNpcStats: false });
            result.noTrackerBar = buildTrackerBox(fixture, { view: 'full' }) === null;
            result.backgroundUnchanged = settings.enabled && buildSceneContext(fixture) === sceneBefore;
            chat.splice(0, chat.length, { mes: 'Smoke story', swipe_id: 0, extra: {
              sillynpc_reader_report: { swipe: 0, status: 'done', summary: 'Smoke report',
                output: { player: { stats: { HP: '17/20' } } } } } });
            const message = document.createElement('div');
            message.innerHTML = '<div class="mes_text">Smoke story</div>';
            settings.showRawTrackerOutput = true;
            renderExtractionReport(message, 0);
            result.reportShown = !!message.querySelector('.sillynpc-reader-report details');
            settings.showRawTrackerOutput = false;
            renderExtractionReport(message, 0);
            result.reportHidden = !message.querySelector('.sillynpc-reader-report')
              && getExtractionReport(0)?.summary === 'Smoke report';
            settings.showRawTrackerOutput = true;
            renderExtractionReport(message, 0);
            result.reportRestored = !!message.querySelector('.sillynpc-reader-report details');
            const warning = 'Collection "missing" skipped: expected "moves". <img src=x onerror=alert(1)>';
            chat[0].extra.sillynpc_reader_report.warnings = [warning];
            settings.showRawTrackerOutput = false;
            renderExtractionReport(message, 0);
            const warningBox = message.querySelector('.sillynpc-reader-warnings');
            result.collectionWarningsVisible = warningBox?.textContent.includes(warning)
              && !warningBox.querySelector('img')
              && !message.querySelector('.sillynpc-reader-content');
            delete chat[0].extra.sillynpc_reader_report.warnings;
            renderExtractionReport(message, 0);
            result.collectionWarningsCleared = !message.querySelector('.sillynpc-reader-report');
            result.manualOption = !!panel.querySelector('option[value="manual"]');
            result.buttons = document.querySelectorAll('#sillynpc-read-button').length;
            result.accessible = document.querySelector('#sillynpc-read-button')?.getAttribute('aria-label');
            settings.enabled = false; refreshReadButton();
            result.hiddenWhenDisabled = !document.querySelector('#sillynpc-read-button');
            settings.enabled = true; settings.extractionMode = 'extract'; refreshReadButton();
            result.hiddenWhenAutomatic = !document.querySelector('#sillynpc-read-button');
          } catch (error) { result.error = String(error); }
          finally {
            chat.splice(0, chat.length, ...savedChat);
            for (const key of keys) {
              if (saved[key] === undefined) delete settings[key];
              else settings[key] = saved[key];
            }
            renderStatusView(panel); refreshReadButton();
          }
          document.documentElement.setAttribute('data-manual-smoke', JSON.stringify(result));
        `;
        document.head.appendChild(script);""")
    manual_result = None
    for _ in range(40):
        raw = execute("return document.documentElement.getAttribute('data-manual-smoke')")
        if raw:
            manual_result = json.loads(raw)
            break
        time.sleep(0.25)
    execute("""document.querySelector('#sillynpc-manual-smoke')?.remove();
        document.documentElement.removeAttribute('data-manual-smoke');""")
    assert manual_result and manual_result.get('manualOption'), manual_result
    assert manual_result.get('sceneStatusOnly') and manual_result.get('playerLoreFields'), manual_result
    assert manual_result.get('buttons') == 1 and manual_result.get('accessible'), manual_result
    assert manual_result.get('hiddenWhenDisabled') and manual_result.get('hiddenWhenAutomatic'), manual_result
    assert all(manual_result.get(key) for key in [
        'visibilityControls', 'visibilityCombinations', 'customCollectionVisibility',
        'noTrackerBar', 'backgroundUnchanged', 'reportShown', 'reportHidden', 'reportRestored',
        'collectionWarningsVisible', 'collectionWarningsCleared',
        'rewardsInitiallyHidden', 'rewardsEnabled', 'rewardsVisibleOnLoad', 'rewardsActualFields',
        'rewardsIdentifierValidation', 'rewardsRangeValidation', 'rewardsValidSchedule',
        'rewardsNarrowLayout', 'rewardsGuidedControls', 'rewardsIntervalValidation',
        'rewardsValidInterval', 'rewardsDisabled',
    ]), manual_result
    execute("document.querySelector('.sillynpc-section[data-section=systems]').click()")
    system_nav = execute("""return {
        section: document.querySelector('.sillynpc-section.active')?.textContent.trim(),
        page: document.querySelector('.sillynpc-subtabs .sillynpc-tab.active:not([hidden])')?.dataset.tab || document.querySelector('.sillynpc-section.active')?.dataset.tab,
        subtabsHidden: document.querySelector('.sillynpc-subtabs')?.hidden,
        panelLabel: document.querySelector('[data-panel=systems]')?.getAttribute('aria-labelledby'),
        builderVisible: !!document.querySelector('.sillynpc-system-builder')};""")
    assert system_nav == {'section': 'System', 'page': 'systems', 'subtabsHidden': True,
                          'panelLabel': 'sillynpc-section-systems', 'builderVisible': True}, system_nav
    execute("[...document.querySelectorAll('.sillynpc-system-builder [role=tab]')].find(el => el.textContent.trim() === 'Player Stats').click()")
    result = execute("""const rows = [...document.querySelectorAll('.sillynpc-system-builder .sillynpc-alias-row')];
        return {rows: rows.length,
          obsoletePolicies: rows.filter(row => row.querySelector('.stat-update-policy')).length,
          purpose: rows.filter(row => row.querySelector('.stat-purpose')).length,
          numericOptions: rows.filter(row => row.querySelector('.stat-type')?.value === 'number'
            && row.querySelector('.stat-options')).length,
          wrongMaxLabels: rows.filter(row => {
            if (row.querySelector('.stat-type')?.value !== 'number') return false;
            const pool = row.querySelector('.stat-default')?.value.includes('/');
            const label = [...row.querySelectorAll('small')].map(el => el.textContent.trim())
              .find(text => text === 'Max:' || text === 'Capacity limit:');
            return label !== (pool ? 'Capacity limit:' : 'Max:');
          }).length};""")
    assert result['rows'] > 0 and result['purpose'] == result['rows'], result
    assert result['obsoletePolicies'] == 0
    assert result['numericOptions'] == 0 and result['wrongMaxLabels'] == 0, result
    execute("""const input = document.querySelector('#sillynpc-settings-search input');
        input.value = 'Speech Block Dividers'; input.dispatchEvent(new Event('input', {bubbles: true}));""")
    execute("document.querySelector('.sillynpc-settings-search-hit').click()")
    search_result = execute("""return {
        section: document.querySelector('.sillynpc-section.active')?.dataset.section,
        detailsOpen: document.querySelector('[data-setting=dividerStyle]')?.closest('details')?.open,
        activePage: document.querySelector('.sillynpc-subtabs .sillynpc-tab.active:not([hidden])')?.dataset.tab || document.querySelector('.sillynpc-section.active')?.dataset.tab};""")
    assert execute("return !!document.querySelector('#sillynpc-appearance-view #sillynpc-hud-view [data-setting]')")
    assert search_result == {'section': 'appearance', 'detailsOpen': True,
                             'activePage': 'appearance'}, search_result
    execute("document.querySelector('.sillynpc-section[data-section=more]').click()")
    more = execute("""return {
        page: document.querySelector('.sillynpc-subtabs .sillynpc-tab.active:not([hidden])')?.dataset.tab || document.querySelector('.sillynpc-section.active')?.dataset.tab,
        subtabsHidden: document.querySelector('.sillynpc-subtabs')?.hidden};""")
    assert more == {'page': 'advanced', 'subtabsHidden': True}, more
    assert execute("return !!document.querySelector('#sillynpc-advanced-view #sillynpc-stats-view h3')")
    browser.resize(600, 900)
    execute("document.querySelector('.sillynpc-section[data-section=status]').click()")
    narrow = execute("""const tabs = document.querySelector('.sillynpc-tabs');
        return {overflow: tabs.scrollWidth > tabs.clientWidth + 2,
          visiblePages: [...document.querySelectorAll('.sillynpc-subtabs .sillynpc-tab')]
            .filter(tab => !tab.hidden).length};""")
    assert narrow == {'overflow': False, 'visiblePages': 0}, narrow
    print('SillyNPC live UI passed:', json.dumps(result))
