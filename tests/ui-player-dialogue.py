"""Check narrator-attributed player dialogue in the running host without saving fixtures."""
import json
import time
from ui_webdriver import browser_session

with browser_session() as browser:
    browser.execute("""
        const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
        const script = document.createElement('script');
        script.type = 'module'; script.id = 'sillynpc-player-dialogue-test';
        script.textContent = `
            const base = ${JSON.stringify(new URL('.', entry.src).href)};
            const result = {};
            try {
                const logic = await import(base + 'src/tracker/status-logic.js');
                const { injectAtDialogueLines } = await import(base + 'src/chat/chat-speech.js');
                const name = logic.getCurrentPersonaName();
                const persona = logic.resolvePersonaSpeaker(name);
                const container = document.createElement('div');
                const paragraph = document.createElement('p');
                const dialogue = name + ': "Player dialogue written by the narrator."';
                paragraph.textContent = dialogue;
                container.append(paragraph);
                injectAtDialogueLines(container, [], () => '/img/ai4.png', false);
                const avatar = container.querySelector('.sillynpc-chat-avatar');
                result.playerAvatar = avatar?.dataset.persona === 'true';
                result.playerPortrait = !!persona && avatar?.getAttribute('src') === persona.imageUrl;
                result.playerSheetAction = avatar?.title.includes('click to open your sheet');
                result.noNpc = !avatar?.dataset.charId && !avatar?.dataset.default;
                result.dialoguePreserved = container.textContent === dialogue;
                result.notCast = !logic.mayJoinScene(name);
            } catch (error) { result.error = String(error); }
            document.documentElement.setAttribute('data-player-dialogue-test', JSON.stringify(result));
        `;
        document.head.append(script);
    """)
    result = None
    try:
        for _ in range(40):
            raw = browser.execute("return document.documentElement.getAttribute('data-player-dialogue-test')")
            if raw:
                result = json.loads(raw)
                break
            time.sleep(0.25)
        assert result and not result.get('error') and all(result.values()), result
        print('Player dialogue live UI passed:', json.dumps(result))
    finally:
        browser.execute("""document.querySelector('#sillynpc-player-dialogue-test')?.remove();
            document.documentElement.removeAttribute('data-player-dialogue-test');""")
