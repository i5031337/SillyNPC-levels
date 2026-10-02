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
