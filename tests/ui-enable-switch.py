"""Unsaved master-switch fixtures in the running SillyTavern page; no model calls."""
import json
import time
from ui_webdriver import browser_session

with browser_session() as browser:
    browser.execute("document.querySelector('#sillynpc-open-manage').click()")
    time.sleep(0.5)
    browser.execute("""document.querySelector('.sillynpc-section[data-section=more]').click();
        const entry = [...document.scripts].find(s => s.src.includes('/SillyNPC-XP/index.js'));
        const script = document.createElement('script');
        script.type = 'module'; script.id = 'sillynpc-enable-smoke';
        script.textContent = `
          const root = ${JSON.stringify(new URL('.', entry.src).href)};
          const { getSettings } = await import(root + 'src/core/settings.js');
          const { refreshExtensionEnabled } = await import(root + 'src/entry/entry-enabled.js');
          const { buildSettingToggle } = await import(root + 'src/ui/shared/ui-shared.js');
          const { reprocessMessage, reprocessAllMessages, setReprocessCallback } = await import(root + 'src/chat/chat.js');
          const { extractStateFromMessage } = await import(root + 'src/tracker/extractor/status-extractor.js');
          const settings = getSettings();
          const saved = { enabled: settings.enabled, tracker: { ...settings.statusTracker },
            dialogueList: settings.dialogueFormatInPromptList };
          const fixture = document.createElement('div');
          const result = {};
          let redraws = 0;
          try {
            result.bothPlaces = !!document.querySelector('#sillynpc-settings [data-setting="enabled"] input')
              && !!document.querySelector('#sillynpc-advanced-view [data-setting="enabled"] input');
            setReprocessCallback(() => { redraws++; });
            settings.dialogueFormatInPromptList = false;
            settings.statusTracker.enabled = true;
            settings.statusTracker.extractionMode = 'manual';
            settings.statusTracker.scanButtonEnabled = true;
            // Exercise the same control builder with a no-op save to keep fixtures unsaved.
            const toggle = buildSettingToggle({ key: 'enabled', label: 'Fixture master',
              store: { get: () => settings, save: () => {} }, onChange: refreshExtensionEnabled });
            fixture.append(toggle); document.body.append(fixture);
            const input = toggle.querySelector('input');
            input.checked = false; input.dispatchEvent(new Event('change'));
            result.synchronizedOff = [...document.querySelectorAll('[data-setting="enabled"] input')]
              .every(el => !el.checked);
            result.buttonsOff = !document.querySelector('#sillynpc-read-button, #sillynpc-scan-button');
            result.hudOff = !document.querySelector('#sillynpc-hud')
              || getComputedStyle(document.querySelector('#sillynpc-hud')).display === 'none';
            result.readerOff = (await extractStateFromMessage('Fixture', 0, { force: true })).reason === 'extension disabled';
            const mes = document.createElement('div');
            mes.innerHTML = '<div class="extraMesButtons"><div class="sillynpc-refresh-btn"></div><div class="sillynpc-tracker-eye"></div></div><div class="mes_text"><p class="sillynpc-speech-block color-text"><img class="sillynpc-chat-avatar"><div class="sillynpc-speech-text">Fixture dialogue</div></p></div><div class="sillynpc-status-tracker-container"></div><div class="sillynpc-review-panel"></div><div class="sillynpc-reader-report"></div>';
            fixture.append(mes); reprocessMessage(mes);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            result.decorationsOff = !mes.querySelector('[class*="sillynpc-"]')
              && mes.textContent === 'Fixture dialogue';
            input.checked = true; input.dispatchEvent(new Event('change'));
            result.synchronizedOn = [...document.querySelectorAll('[data-setting="enabled"] input')]
              .every(el => el.checked);
            result.buttonsOn = !!document.querySelector('#sillynpc-read-button')
              && !!document.querySelector('#sillynpc-scan-button');
            result.redraws = redraws === 2;
          } catch (error) { result.error = String(error.stack || error); }
          finally {
            fixture.remove(); settings.enabled = saved.enabled;
            Object.assign(settings.statusTracker, saved.tracker);
            settings.dialogueFormatInPromptList = saved.dialogueList;
            refreshExtensionEnabled(); setReprocessCallback(reprocessAllMessages);
          }
          document.documentElement.setAttribute('data-enable-smoke', JSON.stringify(result));
        `;
        document.head.append(script);""")
    result = None
    for _ in range(80):
        raw = browser.execute("return document.documentElement.getAttribute('data-enable-smoke')")
        if raw:
            result = json.loads(raw)
            break
        time.sleep(0.25)
    browser.execute("""document.querySelector('#sillynpc-enable-smoke')?.remove();
        document.documentElement.removeAttribute('data-enable-smoke');""")
    assert result and all(value is True for value in result.values()), result
    print(json.dumps(result, indent=2))
