"""Read-only profile payload integration check; intercepts the fixture before any API request."""
import json
import time
from ui_webdriver import browser_session


with browser_session() as browser:
    browser.execute(r"""
        const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
        if (!entry) throw new Error('SillyNPC entry script not loaded');
        const script = document.createElement('script');
        script.type = 'module'; script.id = 'sillynpc-connection-smoke';
        script.onerror = () => document.documentElement.setAttribute('data-sillynpc-connection-smoke',
            JSON.stringify({ error: 'Page module failed to load or parse', source: script.textContent }));
        script.textContent = `
          try {
            const { customProfilePayload } = await import(${JSON.stringify(new URL('src/api/api-connection-profile.js', entry.src).href)});
            const { substituteParams } = await import('/script.js');
            const context = SillyTavern.getContext();
            const service = context.ConnectionManagerRequestService;
            const api = Object.keys(context.CONNECT_API_MAP).find(key =>
              context.CONNECT_API_MAP[key].selected === 'openai' && context.CONNECT_API_MAP[key].source === 'custom');
            const profile = { id: 'sillynpc-fixture', api, model: 'fixture',
              preset: 'SillyNPC fixture preset', 'api-url': 'http://sillynpc-fixture.invalid' };
            const preset = { custom_include_body: 'temperature: 0.9\\nmax_tokens: 900',
              custom_exclude_body: '', custom_include_headers: 'X-User: {{user}}',
              temperature: 1.8, top_p: 0.3 };
            class FixtureService extends service {
              static getProfile(id) {
                if (id !== profile.id) throw new Error('Unexpected profile');
                return profile;
              }
            }
            const selected = context.extensionSettings.connectionManager.selectedProfile;
            const manager = context.getPresetManager('openai');
            const originalGetPreset = manager.getCompletionPresetByName;
            const completion = context.ChatCompletionService;
            const originalSend = completion.sendRequest;
            let result;
            try {
              manager.getCompletionPresetByName = function(name) {
                if (name === profile.preset) return preset;
                return originalGetPreset.call(this, name);
              };
              const overrides = customProfilePayload({ ...context, ConnectionManagerRequestService: FixtureService }, profile.id);
              completion.sendRequest = function(data, ...args) {
                if (data.custom_url === profile['api-url']) return Promise.resolve(data);
                return originalSend.call(this, data, ...args);
              };
              result = await FixtureService.sendRequest(profile.id,
                [{ role: 'user', content: 'Fixture' }], 400, { includePreset: false },
                { temperature: 0.2, ...overrides });
            } finally {
              completion.sendRequest = originalSend;
              manager.getCompletionPresetByName = originalGetPreset;
            }
            if (result.custom_include_body !== preset.custom_include_body ||
                result.custom_exclude_body !== '' ||
                result.custom_include_headers !== substituteParams(preset.custom_include_headers) ||
                result.temperature !== 0.2 || result.max_tokens !== 400 ||
                result.top_p !== undefined ||
                context.extensionSettings.connectionManager.selectedProfile !== selected)
              throw new Error('Profile payload or connection isolation failed');
            document.documentElement.setAttribute('data-sillynpc-connection-smoke', JSON.stringify({ ok: true }));
          } catch (error) {
            document.documentElement.setAttribute('data-sillynpc-connection-smoke', JSON.stringify({ error: String(error.stack || error) }));
          }
        `;
        document.body.append(script);
    """)
    try:
        result = None
        for _ in range(100):
            result = browser.execute("return document.documentElement.getAttribute('data-sillynpc-connection-smoke')")
            if result:
                break
            time.sleep(0.1)
        assert result, 'Page module timed out'
        result = json.loads(result)
        assert result.get('ok'), result
        print(json.dumps(result))
    finally:
        browser.execute("""document.querySelector('#sillynpc-connection-smoke')?.remove();
            document.documentElement.removeAttribute('data-sillynpc-connection-smoke');""")
