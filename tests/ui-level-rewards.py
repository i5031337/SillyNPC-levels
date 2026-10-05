"""Read-only level-up preview and review DOM fixture for running SillyTavern."""
import json
import socket
import subprocess
import time
import urllib.request

with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
base = f'http://127.0.0.1:{port}'


def webdriver(method, path, data=None):
    body = None if data is None else json.dumps(data).encode()
    request = urllib.request.Request(base + path, body, {'Content-Type': 'application/json'}, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)['value']
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode()) from error


driver = subprocess.Popen(['geckodriver', '--port', str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
    execute = lambda script: webdriver('POST', f'/session/{session}/execute/sync', {'script': script, 'args': []})
    webdriver('POST', f'/session/{session}/window/rect', {'width': 600, 'height': 900})
    execute("""const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
      if (!entry) throw new Error('Extension entry script missing');
      const script = document.createElement('script'); script.type = 'module'; script.id = 'sillynpc-level-fixture';
      script.textContent = `
        const result = {};
        let settings, originalTracker, live, savedLive, chat, savedChat, host;
        try {
          const root = ${JSON.stringify(new URL('.', entry.src).href)};
          const { getSettings } = await import(root + 'src/core/settings.js');
          const { loadStateFromMetadata, applyUpdate, getCurrentPersonaKey } = await import(root + 'src/tracker/status-logic.js');
          const { computeStateDiff } = await import(root + 'src/tracker/status-diff.js');
          const { selectLevelGrants, collectLevelTransitions } = await import(root + 'src/tracker/extractor/status-level-grants.js');
          const { prepareGrantReview, materializeGrantRows, selectReviewRows } = await import(root + 'src/tracker/level-grant-review.js');
          const { renderReviewPanel } = await import(root + 'src/ui/tracker/ui-change-review.js');
          settings = getSettings(); originalTracker = settings.statusTracker;
          live = loadStateFromMetadata(); savedLive = structuredClone(live);
          chat = SillyTavern.getContext().chat; savedChat = chat.slice();
          const stats = [
            { id: 'xp', name: 'Experience', type: 'number', updatePolicy: 'turn', defaultValue: '0/100' },
            { id: 'level', name: 'Rank', type: 'number', updatePolicy: 'advancement', defaultValue: '1' },
            { id: 'health', name: 'Health', type: 'bar', updatePolicy: 'turn', defaultValue: '10/10' },
            { id: 'power', name: 'Power', type: 'number', updatePolicy: 'advancement', defaultValue: '3', maxStatValue: '10' }
          ];
          const progression = { enabled: true, xpFieldId: 'xp', levelFieldId: 'level', statGrowth: 'all',
            statIds: ['health', 'power'], increments: { health: 1, power: 1 } };
          const templates = [
            { id: 'levels-enabled', name: 'Levels enabled', statIds: stats.map(stat => stat.id), progression },
            { id: 'levels-disabled', name: 'Levels disabled', statIds: stats.map(stat => stat.id), progression: { ...progression, enabled: false } }
          ];
          const collection = { id: 'techniques', targets: ['player', 'npc', 'template:levels-enabled'],
            fields: [{ id: 'title', name: 'title', label: 'Technique', type: 'text', isPrimary: true }],
            levelUpRewards: { enabled: true, mode: 'scheduled', schedule: [{ id: 'dash', level: 2, entry: { title: 'Dash' } }] } };
          const tracker = { ...structuredClone(originalTracker), globalStats: [], playerStats: stats, npcStats: stats,
            npcTemplates: templates, progression: { player: progression }, collections: [collection],
            presets: { ...originalTracker.presets, [settings.activeSystem]: { definition: { npcTemplates: templates, stats: { npc: stats } } } } };
          settings.statusTracker = tracker;
          const readings = { Experience: '90/100', Rank: '1', Health: '6/10', Power: '3' };
          const fixture = { ...savedLive, global: {}, player: { ...savedLive.player, name: 'Fixture Player', stats: { ...readings }, collections: {} },
            characters: [
              { id: 'fixture-enabled', name: 'Fixture Enabled NPC', npcTemplateId: 'levels-enabled', stats: { ...readings }, collections: {} },
              { id: 'fixture-disabled', name: 'Fixture Disabled NPC', npcTemplateId: 'levels-disabled', stats: { ...readings }, collections: {} }
            ], recently_deleted: {} };
          for (const key of Object.keys(live)) delete live[key]; Object.assign(live, fixture);
          const parsed = { player: { stats: { Experience: '110/100' } }, characters: [
            { name: 'Fixture Enabled NPC', stats: { Experience: '110/100' } },
            { name: 'Fixture Disabled NPC', stats: { Experience: '95/100' } }
          ] };
          const context = { messageId: 0, swipeId: 0, personaId: getCurrentPersonaKey(),
            system: tracker.presets[settings.activeSystem].definition, requestExtraction: () => { throw new Error('Fixture must not request models'); } };
          const preview = applyUpdate(parsed, { dryRun: true });
          result.playerRollover = preview.player.stats.Rank === '2' && preview.player.stats.Experience === '10/100';
          result.npcRollover = preview.characters[0].stats.Rank === '2' && preview.characters[0].stats.Experience === '10/100';
          result.disabledUnchanged = preview.characters[1].stats.Rank === '1' && preview.characters[1].stats.Experience === '95/100';
          result.dryRunPure = live.player.stats.Rank === '1' && live.characters[0].stats.Rank === '1';
          const selection = await selectLevelGrants(parsed, fixture, tracker, '', [], context);
          const transitions = collectLevelTransitions(parsed, fixture, tracker, context);
          result.grantCounts = selection.rows.length === 6 && selection.failures.length === 0
            && !selection.rows.some(row => row.actor === 'Fixture Disabled NPC');
          const pending = computeStateDiff(fixture, preview, tracker).filter(row => row.actor !== 'Fixture Disabled NPC');
          prepareGrantReview([], pending, transitions); pending.push(...selection.rows);
          chat.splice(0, chat.length, { mes: 'Fixture level-up', swipe_id: 0, extra: { sillynpc_pending: pending } });
          host = document.createElement('div'); host.style.width = '280px'; host.style.position = 'fixed'; host.style.left = '0'; host.style.top = '0';
          document.body.append(host); renderReviewPanel(host, 0);
          const panel = host.querySelector('.sillynpc-review-panel');
          result.reviewRecipients = panel.textContent.includes('You') && panel.textContent.includes('Fixture Enabled NPC')
            && !panel.textContent.includes('Fixture Disabled NPC');
          result.reviewRewards = [...panel.querySelectorAll('.kind-item-add')].length === 2
            && [...panel.querySelectorAll('.sillynpc-review-to')].filter(el => el.textContent === '+1').length === 4;
          const dependencies = [...panel.querySelectorAll('.sillynpc-review-row')].filter(el =>
            ['Experience', 'Rank'].includes(el.querySelector('.sillynpc-review-label')?.textContent));
          const firstToggle = dependencies[0].querySelector('input[type=checkbox]');
          firstToggle.focus(); result.keyboard = document.activeElement === firstToggle;
          firstToggle.click();
          result.dependencies = [...panel.querySelectorAll('.sillynpc-review-toggle:disabled')].length === 3;
          firstToggle.click();
          result.dependenciesRestored = panel.querySelectorAll('.sillynpc-review-toggle:disabled').length === 0;
          result.narrowLayout = host.scrollWidth <= host.clientWidth + 2;
          const applied = materializeGrantRows(selection.rows, preview, tracker, [], {
            acceptedTransitionIds: transitions.map(t => t.transitionId), personaId: getCurrentPersonaKey() });
          result.acceptanceMath = applied.rows.filter(row => row.label === 'Health' && row.kind === 'stat').every(row => row.grant.valueAfter === '7/11');
          result.rejectedXpBlocks = selectReviewRows(pending, selection.rows).rows.length === 0;
        } catch (error) { result.error = String(error); result.stack = error.stack; }
        finally {
          host?.remove();
          if (chat && savedChat) chat.splice(0, chat.length, ...savedChat);
          if (live && savedLive) { for (const key of Object.keys(live)) delete live[key]; Object.assign(live, savedLive); }
          if (settings && originalTracker) settings.statusTracker = originalTracker;
        }
        document.documentElement.setAttribute('data-level-fixture', JSON.stringify(result));
      `;
      document.head.appendChild(script);""")
    result = None
    for _ in range(100):
        raw = execute("return document.documentElement.getAttribute('data-level-fixture')")
        if raw:
            result = json.loads(raw)
            break
        time.sleep(0.25)
    execute("document.querySelector('#sillynpc-level-fixture')?.remove(); document.documentElement.removeAttribute('data-level-fixture');")
    expected = ['playerRollover', 'npcRollover', 'disabledUnchanged', 'dryRunPure', 'grantCounts', 'reviewRecipients',
                'reviewRewards', 'keyboard', 'dependencies', 'dependenciesRestored', 'narrowLayout', 'acceptanceMath', 'rejectedXpBlocks']
    assert result and all(result.get(key) for key in expected), result
    print('SillyNPC level rewards UI passed:', json.dumps(result))
finally:
    if session:
        try:
            webdriver('DELETE', f'/session/{session}')
        except Exception:
            pass
    try:
        driver.terminate()
    except PermissionError:
        pass
