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
    execute("""const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
      const script = document.createElement('script'); script.type = 'module'; script.id = 'sillynpc-template-smoke';
      script.textContent = `
        const root = ${JSON.stringify(new URL('.', entry.src).href)};
        const { getSettings } = await import(root + 'src/core/settings.js');
        const { normalizeSystemDefinition } = await import(root + 'src/core/system-schema.js');
        const { buildSystemBuilder } = await import(root + 'src/ui/system/ui-system-builder.js');
        const { buildNpcTemplateSelect } = await import(root + 'src/ui/characters/ui-npc-template.js');
        const { renderProfileFields } = await import(root + 'src/ui/characters/ui-profile.js');
        const { buildStatusHtml } = await import(root + 'src/tracker/ui/status-ui-template.js');
        const { buildUserPrompt } = await import(root + 'src/tracker/extractor/status-extractor-prompt.js');
        const { buildUpdateFromChanges } = await import(root + 'src/tracker/status-diff-review.js');
        const { renderReviewPanel } = await import(root + 'src/ui/tracker/ui-change-review.js');
        const { formatLoreContent, parseLoreContent } = await import(root + 'src/lore/lore-format.js');
        const settings = getSettings();
        const chat = SillyTavern.getContext().chat;
        const savedChat = chat.slice();
        const active = settings.activeSystem;
        const tracker = settings.statusTracker;
        const host = document.createElement('div');
        host.id = 'sillynpc-template-fixture'; document.body.append(host);
        let result;
        try {
          const definition = normalizeSystemDefinition({ schemaVersion: 1, name: 'Fixture',
            profiles: { player: [], npc: [{ id: 'occupation', label: 'Occupation' }, { id: 'species', label: 'Species' }] },
            stats: { world: [], player: [], npc: [
              { id: 'hp', name: 'HP', type: 'number', defaultValue: '10/10' },
              { id: 'friendship', name: 'Friendship', type: 'number', defaultValue: '0' }] },
            npcTemplates: [
              { id: 'human', name: 'Human', description: 'Human trainers.', profileIds: ['occupation'], statIds: ['hp'] },
              { id: 'pokemon', name: 'Pokémon', description: 'Pokémon creatures.', profileIds: ['species'], statIds: ['hp', 'friendship'] }] });
          settings.activeSystem = 'Fixture';
          settings.statusTracker = { ...tracker, presets: { Fixture: { definition } }, npcStats: definition.stats.npc, globalStats: [], playerStats: [], collections: [] };
          const builder = buildSystemBuilder(() => {}); host.append(builder);
          [...builder.querySelectorAll('[role=tab]')].find(tab => tab.textContent === 'NPC Templates').click();
          const sections = [...builder.querySelectorAll('.sillynpc-npc-templates details')];
          const human = { name: 'Trainer', npcTemplateId: 'human', profile: {} };
          const pokemon = { name: 'Pikachu', npcTemplateId: 'pokemon', profile: {} };
          const state = { global: {}, player: { stats: {} }, characters: [
            { ...human, stats: { HP: '8/10', Friendship: '99' }, collections: {} },
            { ...pokemon, stats: { HP: '6/10', Friendship: '50' }, collections: {} }] };
          const selector = buildNpcTemplateSelect(pokemon, () => {}, state); host.append(selector);
          const humanFields = document.createElement('div'); const pokemonFields = document.createElement('div');
          host.append(humanFields, pokemonFields);
          renderProfileFields(human, humanFields); renderProfileFields(pokemon, pokemonFields);
          const box = document.createElement('div');
          box.innerHTML = buildStatusHtml(state, settings.statusTracker); host.append(box);
          const rows = [...box.querySelectorAll('.sillynpc-character-status, .sillynpc-status-char')];
          chat.splice(0, chat.length, { extra: { sillynpc_pending: [{
            scope: 'character', actor: 'Unknown NPC', label: 'NPC template', kind: 'npc-template',
            before: '(unassigned)', after: '', risk: 'risky', reason: 'Choose an NPC template' }] } });
          const review = document.createElement('div'); host.append(review); renderReviewPanel(review, 0);
          const reviewSelect = review.querySelector('select.sillynpc-review-to');
          reviewSelect.value = 'pokemon'; reviewSelect.dispatchEvent(new Event('change'));
          const lore = formatLoreContent({ species: 'Pikachu' }, '', undefined, 'npc',
            [{ id: 'species', label: 'Species' }]);
          const reader = buildUserPrompt(state, 'Trainer greets Pikachu.', settings.statusTracker);
          const rebuilt = buildUpdateFromChanges([
            { scope: 'character', actor: 'Saori', kind: 'npc-template', after: 'npc' },
            { scope: 'character', actor: 'Saori', kind: 'stat', label: 'Condition', after: 'Healthy' },
            { scope: 'character', actor: 'Saori', kind: 'stat', label: 'Standing', after: 0 }
          ], { characters: [{ name: 'Saori', stats: {}, collections: {} }] }, settings.statusTracker);
          result = {
            templateWithStats: rebuilt.characters[0].npcTemplateId === 'npc'
              && rebuilt.characters[0].stats.Condition === 'Healthy'
              && rebuilt.characters[0].stats.Standing === '0',
            reviewOptions: [...reviewSelect.options].map(option => option.value),
            reviewSelected: reviewSelect.value,
            loreSelectedOnly: lore === 'Species: Pikachu' && parseLoreContent(lore)?.species === 'Pikachu',
            templates: sections.map(section => section.querySelector('summary').textContent),
            selections: sections.map(section => [...section.querySelectorAll('input[type=checkbox]')].map(input => input.checked)),
            selected: selector.querySelector('select').value,
            options: [...selector.querySelectorAll('option')].map(option => option.value),
            humanFields: [...humanFields.querySelectorAll('.sillynpc-profile-label')].map(label => label.textContent.trim()),
            pokemonFields: [...pokemonFields.querySelectorAll('.sillynpc-profile-label')].map(label => label.textContent.trim()),
            readerTemplates: reader.includes('npcTemplateId') && reader.includes('Human trainers.') && reader.includes('Pokémon creatures.'),
            humanHidden: !box.innerHTML.includes('99'), pokemonShown: box.innerHTML.includes('50'),
            box: box.textContent
          };
        } catch (error) { result = { error: error.stack }; }
        finally { settings.activeSystem = active; settings.statusTracker = tracker; chat.splice(0, chat.length, ...savedChat); host.remove(); }
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
    assert result['templates'] == ['Human', 'Pokémon'], result
    assert result['selections'] == [[True, False, True, False], [False, True, True, True]], result
    assert result['selected'] == 'pokemon' and result['options'] == ['', 'human', 'pokemon'], result
    assert result['humanFields'] == ['Occupation'] and result['pokemonFields'] == ['Species'], result
    assert result['templateWithStats'], result
    assert result['reviewOptions'] == ['', 'human', 'pokemon'] and result['reviewSelected'] == 'pokemon', result
    assert result['loreSelectedOnly'], result
    assert result['readerTemplates'] and result['humanHidden'] and result['pokemonShown'], result
    print('NPC templates live UI passed:', json.dumps(result))
finally:
    if session:
        try: webdriver('DELETE', f'/session/{session}')
        except Exception: pass
    try:
        driver.terminate()
    except PermissionError:
        # Some sandbox runners own the driver; the WebDriver session is closed above.
        pass
