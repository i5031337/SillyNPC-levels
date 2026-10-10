"""Unsaved portrait UI checks. No image requests or host settings writes."""
import json
import time
from ui_webdriver import browser_session

with browser_session() as browser:
    browser.execute("""const entry = [...document.scripts].find(s => s.src.includes('/SillyNPC-XP/index.js'));
        const script = document.createElement('script'); script.type = 'module'; script.id = 'sillynpc-image-smoke';
        script.textContent = `
          const root = ${JSON.stringify(new URL('.', entry.src).href)};
          const { buildCharacterImagePrompt } = await import(root + 'src/api/api-image-generate.js');
          const { generateCharacterImage } = await import(root + 'src/ui/api/ui-api-image.js');
          const { renderImageSettingsView } = await import(root + 'src/ui/settings/ui-settings-generation.js');
          const { renderTrackerDisplayAndReading } = await import(root + 'src/ui/tracker/ui-tracker-display-reading.js');
          const { getSettings } = await import(root + 'src/core/settings.js');
          const { buildProfilesEditor } = await import(root + 'src/ui/system/ui-system-profiles.js');
          const result = {};
          const { normalizeSystemDefinition } = await import(root + 'src/core/system-schema.js');
          const fixture = normalizeSystemDefinition({ schemaVersion: 2, profiles: [{ id: 'species', label: 'Species', targets: ['npc'], includeInImagePrompt: true }] });
          const host = document.createElement('div');
          let saves = 0;
          try {
            const imageSettings = document.createElement('div');
            renderImageSettingsView(imageSettings);
            result.noAutomaticFillHeading = ![...imageSettings.querySelectorAll('h3')].some(el => el.textContent === 'Automatic NPC Fill');
            const portraitToggle = imageSettings.querySelector('[data-setting=autoPortraitOnFill]');
            let heading = portraitToggle?.previousElementSibling;
            while (heading && heading.tagName !== 'H3') heading = heading.previousElementSibling;
            result.portraitUnderImages = heading?.textContent === 'Image Generation'
              && imageSettings.querySelectorAll('[data-setting=autoPortraitOnFill]').length === 1;
            const tracker = document.createElement('div');
            renderTrackerDisplayAndReading({ container: tracker,
              settings: { ...getSettings().statusTracker, extractionMode: 'extract' },
              onApply: () => {}, onDisplay: () => {}, onChange: () => {}, section: () => {} });
            result.noTrackerPortraitToggle = !tracker.querySelector('[data-setting=autoPortraitOnFill]')
              && !!tracker.querySelector('[data-setting=\"statusTracker.autoGenerateNpcProfiles\"]');
            host.append(imageSettings);
            const prefix = imageSettings.querySelector('[data-setting=imgGenPromptPrefix] textarea');
            result.noImageContextSetting = !imageSettings.querySelector('[data-setting=imgGenContextMessages]');
            result.prefixSetting = !!prefix && prefix.value === getSettings().imgGenPromptPrefix;
            const editor = buildProfilesEditor(() => {}, { definition: () => fixture, getSettings: () => ({statusTracker: {}}), saveSettings: () => saves++ });
            host.append(editor); document.body.append(host);
            const checkbox = editor.querySelector('.profile-image-prompt');
            result.fieldSelected = checkbox.checked;
            checkbox.click();
            result.fieldToggle = !fixture.profiles[0].includeInImagePrompt && saves === 1;
            const card = { name: 'Portrait Smoke NPC', profile: { age: '30', appearance: 'Blue coat' } };
            const expectedPrompt = await buildCharacterImagePrompt(card);
            const task = generateCharacterImage(card);
            let textarea;
            for (let n = 0; n < 100; n++) {
              textarea = document.querySelector('.sillynpc-image-prompt');
              if (textarea) break;
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            if (!textarea) throw new Error('Image prompt popup did not open');
            const expectedArea = document.createElement('textarea'); expectedArea.value = expectedPrompt;
            result.promptPrefilled = textarea.value === expectedArea.value;
            textarea.value = 'Edited portrait prompt'; textarea.dispatchEvent(new Event('input', { bubbles: true }));
            result.promptEditable = textarea.value === 'Edited portrait prompt';
            const dialog = textarea.closest('dialog');
            const cancel = dialog.querySelector('.popup-button-cancel');
            if (!cancel) throw new Error('Cancel button missing');
            cancel.click(); await task;
            result.cancelClosed = !document.querySelector('.sillynpc-image-prompt');
          } catch (error) { result.error = error.stack || String(error); }
          finally { host.remove(); document.getElementById('sillynpc-image-smoke')?.remove(); }
          document.documentElement.setAttribute('data-image-smoke', JSON.stringify(result));
        `;
        document.body.append(script);""")
    for attempt in range(200):
        result = browser.execute("return document.documentElement.getAttribute('data-image-smoke')")
        if result:
            break
        time.sleep(0.1)
    assert result, 'Portrait UI check timed out'
    data = json.loads(result)
    browser.execute("document.documentElement.removeAttribute('data-image-smoke')")
    assert 'error' not in data, data
    assert all(data.values()), data
    print(json.dumps(data, indent=2))
