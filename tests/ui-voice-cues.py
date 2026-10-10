"""Read-only voice cue regression against the running SillyTavern formatter."""
import json
import time
from ui_webdriver import browser_session


with browser_session() as browser:
    browser.execute(r"""const entry = [...document.scripts].find(script =>
        script.src.includes('/SillyNPC-XP/index.js'));
        const script = document.createElement('script');
        script.type = 'module'; script.id = 'sillynpc-voice-cue-test';
        script.textContent = `
          const root = ${JSON.stringify(new URL('.', entry.src).href)};
          const result = {};
          let element, originalFetch;
          try {
            const { readSpeechUnits } = await import(root + 'src/tts/speech-units.js');
            const { stripVoiceCueNodes, parseVoiceCues } = await import(root + 'src/tts/voice-cue-format.js');
            const { resolveUnitSpeech, normalizeTtsSettings } = await import(root + 'src/tts/tts-settings.js');
            const { synthesizeSpeech } = await import(root + 'src/tts/openai-speech.js');
            const host = SillyTavern.getContext();
            const description = 'high-pitched, bubbly, and frantically energetic, 18';
            const dialogue = "Oh! Oh no, no, no! Please don't... stay... together!";
            const source = '[[NPC_VOICE speaker="Yvonna" description="' + description + '"]]\\n\\nYvonna: "' + dialogue + '"';
            const context = { chat: [{ mes: source, is_user: false }] };
            element = document.createElement('div'); element.setAttribute('mesid', '0');
            const text = document.createElement('div'); text.className = 'mes_text';
            text.innerHTML = host.messageFormatting(source, '', false, false, 0);
            element.append(text);
            const options = { context, characters: [], settings: { caseInsensitive: true },
                ignoredLabels: new Set(), personaFor: () => null };
            // Read before rendering removes the cue: speech must work regardless of event order.
            const units = readSpeechUnits(element, options);
            result.units = units.map(unit => [unit.kind, unit.text]);
            result.cues = parseVoiceCues(source, [{speakerLabel: 'Yvonna', text: dialogue}]);
            const config = normalizeTtsSettings({ enabled: true, model: 'kokoro',
                npcModel: 'qwen3-tts', voices: ['af_heart'], narratorVoice: 'af_heart' });
            const card = { id: 'cue-fixture', presentation: {
                voiceDesign: { description: result.cues[0].description, version: 1 } } };
            const unit = units.find(unit => unit.kind === 'dialogue');
            const choice = resolveUnitSpeech(unit, config, card);
            originalFetch = globalThis.fetch;
            globalThis.fetch = async (_url, request) => {
                result.request = JSON.parse(request.body);
                return new Response(new Blob(['fixture'], {type: 'audio/mpeg'}));
            };
            await synthesizeSpeech({...unit, ...choice}, config, new AbortController().signal);
            const encoded = choice.voice.split(':')[1].replace(/-/g, '+').replace(/_/g, '/');
            result.fields = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))));
            stripVoiceCueNodes(text);
            result.hidden = !text.textContent.includes('NPC_VOICE');
          } catch (error) { result.error = String(error.stack || error); }
          finally {
            if (originalFetch) globalThis.fetch = originalFetch;
            element?.remove();
            document.body.setAttribute('data-voice-cue-test', JSON.stringify(result));
          }
        `;
        document.body.append(script);""")
    try:
        result = None
        for _ in range(100):
            raw = browser.execute("return document.body.getAttribute('data-voice-cue-test')")
            if raw:
                result = json.loads(raw)
                break
            time.sleep(0.1)
        assert result and 'error' not in result, result
        dialogue = "Oh! Oh no, no, no! Please don't... stay... together!"
        # The host's smart punctuation may replace three dots with an ellipsis.
        assert [[kind, text.replace('…', '...')] for kind, text in result['units']] == [['dialogue', dialogue]], result
        assert result['hidden'], result
        assert result['request']['input'].replace('…', '...') == dialogue, result
        assert result['request']['model'] == 'qwen3-tts', result
        assert result['fields']['instructions'] == 'high-pitched, bubbly, and frantically energetic, 18', result
        print(json.dumps(result, indent=2))
    finally:
        browser.execute("document.getElementById('sillynpc-voice-cue-test')?.remove();"
                        "document.body.removeAttribute('data-voice-cue-test')")
