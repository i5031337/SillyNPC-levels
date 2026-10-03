"""Read-only SillyTavern System Builder smoke check; requires a running local server."""
import json
import socket
import subprocess
import time
import urllib.request


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


port = free_port()
base = f'http://127.0.0.1:{port}'


def webdriver(method, path, data=None):
    body = None if data is None else json.dumps(data).encode()
    request = urllib.request.Request(base + path, body,
                                     {'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)['value']


driver = subprocess.Popen(['geckodriver', '--port', str(port)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
session = None
try:
    for _ in range(40):
        try:
            webdriver('GET', '/status')
            break
        except Exception:
            time.sleep(0.25)
    session = webdriver('POST', '/session', {'capabilities': {'alwaysMatch': {
        'browserName': 'firefox', 'moz:firefoxOptions': {'args': ['-headless']},
    }}})['sessionId']
    webdriver('POST', f'/session/{session}/url', {'url': 'http://127.0.0.1:8000/'})
    time.sleep(5)
    execute = lambda script: webdriver('POST', f'/session/{session}/execute/sync',
                                       {'script': script, 'args': []})
    execute("document.querySelector('#sillynpc-open-manage').click()")
    time.sleep(0.5)
    execute("document.querySelector('.sillynpc-section[data-section=status]').click()")
    execute("[...document.querySelectorAll('.sillynpc-tab')].find(el => el.textContent.trim() === 'Tracker').click()")
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
    ]), manual_result
    execute("[...document.querySelectorAll('.sillynpc-tab')].find(el => el.textContent.trim() === 'Systems').click()")
    execute("[...document.querySelectorAll('.sillynpc-system-builder [role=tab]')].find(el => el.textContent.trim() === 'Player').click()")
    result = execute("""const rows = [...document.querySelectorAll('.sillynpc-system-builder .sillynpc-alias-row')];
        return {rows: rows.length,
          purpose: rows.filter(row => row.querySelector('.stat-purpose')).length,
          numericOptions: rows.filter(row => row.querySelector('.stat-type')?.value === 'number'
            && row.querySelector('.stat-options')).length,
          wrongMaxLabels: rows.filter(row => {
            const policy = row.querySelector('.stat-update-policy')?.value;
            if (!policy || row.querySelector('.stat-type')?.value !== 'number') return false;
            const label = [...row.querySelectorAll('small')].map(el => el.textContent.trim())
              .find(text => text === 'Max:' || text === 'Starts max:');
            return label !== (policy === 'advancement' ? 'Max:' : 'Starts max:');
          }).length};""")
    assert result['rows'] > 0 and result['purpose'] == result['rows'], result
    assert result['numericOptions'] == 0 and result['wrongMaxLabels'] == 0, result
    execute("""const input = document.querySelector('#sillynpc-settings-search input');
        input.value = 'Speech Block Dividers'; input.dispatchEvent(new Event('input', {bubbles: true}));""")
    execute("document.querySelector('.sillynpc-settings-search-hit').click()")
    search_result = execute("""return {
        section: document.querySelector('.sillynpc-section.active')?.dataset.section,
        detailsOpen: document.querySelector('[data-setting=dividerStyle]')?.closest('details')?.open,
        activePage: document.querySelector('.sillynpc-tab.active')?.dataset.tab};""")
    assert search_result == {'section': 'appearance', 'detailsOpen': True,
                             'activePage': 'appearance'}, search_result
    execute("document.querySelector('.sillynpc-section[data-section=more]').click()")
    more = execute("""return {
        page: document.querySelector('.sillynpc-tab.active')?.dataset.tab,
        subtabsHidden: document.querySelector('.sillynpc-subtabs')?.hidden};""")
    assert more == {'page': 'advanced', 'subtabsHidden': True}, more
    webdriver('POST', f'/session/{session}/window/rect', {'width': 600, 'height': 900})
    execute("document.querySelector('.sillynpc-section[data-section=status]').click()")
    narrow = execute("""const tabs = document.querySelector('.sillynpc-tabs');
        return {overflow: tabs.scrollWidth > tabs.clientWidth + 2,
          visiblePages: [...document.querySelectorAll('.sillynpc-subtabs .sillynpc-tab')]
            .filter(tab => !tab.hidden).length};""")
    assert narrow == {'overflow': False, 'visiblePages': 4}, narrow
    print('SillyNPC live UI passed:', json.dumps(result))
finally:
    if session:
        try:
            webdriver('DELETE', f'/session/{session}')
        except Exception:
            pass
    try:
        driver.terminate()
    except PermissionError:
        # The WebDriver session was already closed above; some sandbox runners own
        # the driver process under another user and refuse an extra signal here.
        pass
