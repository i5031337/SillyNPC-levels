"""Verify shared dialogue records in the host without saves or model requests."""
import json
import time
from ui_webdriver import browser_session

with browser_session() as browser:
    browser.execute("""
        const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
        const script = document.createElement('script');
        script.type = 'module'; script.id = 'sillynpc-dialogue-presentation-test';
        script.textContent = `
            const base = ${JSON.stringify(new URL('.', entry.src).href)};
            const result = {};
            let settings, saved;
            try {
                const { getSettings } = await import(base + 'src/core/settings.js');
                const { readDialogueRecords } = await import(base + 'src/chat/dialogue-presentation.js');
                const { injectAtDialogueLines } = await import(base + 'src/chat/chat-speech.js');
                const { clearDecorations } = await import(base + 'src/chat/chat-portraits.js');
                const logic = await import(base + 'src/tracker/status-logic.js');
                settings = getSettings();
                const keys = ['enabled', 'caseInsensitive', 'hideSpeakerNames', 'applyColors'];
                saved = Object.fromEntries(keys.map(key => [key, settings[key]]));
                Object.assign(settings, { enabled: true, caseInsensitive: true,
                    hideSpeakerNames: false, applyColors: true });
                const player = logic.getCurrentPersonaName();
                const cards = [
                    { id: 'dialogue-fixture-a', name: 'Zélie', aliases: [] },
                    { id: 'dialogue-fixture-b', name: 'Dialogue Fixture B',
                        aliases: [{ pattern: 'Fixture Alias', isRegex: false }] },
                ];
                let chatId = 'dialogue-fixture-chat';
                const context = { chat: [{ mes: 'Dialogue fixture source', swipe_id: 0 }],
                    getCurrentChatId: () => chatId };
                const mes = document.createElement('div'); mes.setAttribute('mesid', '0');
                const container = document.createElement('div'); container.className = 'mes_text';
                mes.append(container);
                container.innerHTML = '<p>A prose paragraph with no speaker.</p>'
                    + '<p>Zélie: "First words." <em>gestures and mouths "quietly"</em> "More words." She closes the door.</p>'
                    + '<p>Fixture Alias: <q>“A <em>fragmented</em> quotation.”</q> Trailing prose.</p>'
                    + '<p>Zélie: 「Second words.」<br>Dialogue Unknown: ＂Unknown words.＂</p>'
                    + '<p hidden>Zélie: "Hidden words."</p>'
                    + '<div class="sillynpc-status-tracker-container"><p>Zélie: "Tracker words."</p></div>'
                    + '<table><tbody><tr><td>Zélie: "Widget words."</td></tr></tbody></table>';
                const personaParagraph = document.createElement('p');
                personaParagraph.textContent = player + ': "Player words."';
                container.append(personaParagraph);
                const options = { context, characters: cards, settings,
                    ignoredLabels: new Set(), personaFor: logic.resolvePersonaSpeaker };
                const before = readDialogueRecords(mes, options);
                result.dialogueOnly = JSON.stringify(before.map(line => line.text)) === JSON.stringify([
                    'First words. More words.', 'A fragmented quotation.', 'Second words.', 'Unknown words.', 'Player words.',
                ]);
                result.orderAndIds = JSON.stringify(before.map(line => [line.lineIndex, line.npcId]))
                    === JSON.stringify([[0, cards[0].id], [1, cards[1].id], [2, cards[0].id], [3, null], [4, null]]);
                result.aliasResolved = before[1]?.displayName === cards[1].name
                    && before[1]?.speakerLabel === 'Fixture Alias';
                result.personaDistinguished = before[4]?.isPersona === true
                    && before[3]?.isPersona === false;
                result.quotesPreserved = before[1]?.quotedText === '“A fragmented quotation.”'
                    && before[2]?.quotedText === '「Second words.」';
                injectAtDialogueLines(container, cards, () => '/img/ai4.png', false);
                const avatars = [...container.querySelectorAll('.sillynpc-chat-avatar')];
                result.sameHighlightIdentity = avatars.length === before.length
                    && avatars.every((avatar, index) =>
                        (avatar.dataset.charId || null) === before[index].npcId
                        && (avatar.dataset.persona === 'true') === before[index].isPersona);
                result.decoratedRead = JSON.stringify(readDialogueRecords(mes, options)) === JSON.stringify(before);
                for (const paragraph of container.querySelectorAll('p')) {
                    const avatar = paragraph.querySelector('.sillynpc-chat-avatar');
                    if (!avatar || paragraph.querySelectorAll('.sillynpc-chat-avatar').length !== 1) continue;
                    const wrapper = document.createElement('div'); wrapper.className = 'sillynpc-speech-text';
                    for (const node of [...paragraph.childNodes]) if (node !== avatar) wrapper.append(node);
                    paragraph.append(wrapper); paragraph.classList.add('sillynpc-speech-block');
                }
                result.wrappedRead = JSON.stringify(readDialogueRecords(mes, options)) === JSON.stringify(before);
                clearDecorations(container);
                Object.assign(settings, { hideSpeakerNames: true, applyColors: false });
                injectAtDialogueLines(container, cards, () => '/img/ai4.png', false);
                result.namesActuallyHidden = container.querySelector('.sillynpc-speaker-name')?.style.display === 'none';
                result.displayIndependent = JSON.stringify(readDialogueRecords(mes, options)) === JSON.stringify(before);
                container.querySelectorAll('.sillynpc-chat-avatar').forEach(avatar => avatar.remove());
                result.withoutPortraits = JSON.stringify(readDialogueRecords(mes, options)) === JSON.stringify(before);
                clearDecorations(container);
                settings.enabled = false;
                result.masterOffRead = JSON.stringify(readDialogueRecords(mes, options)) === JSON.stringify(before);
                const original = before[0].revision;
                context.chat[0].swipe_id = 1;
                const swipe = readDialogueRecords(mes, options)[0].revision;
                context.chat[0].mes = 'Edited source';
                const edit = readDialogueRecords(mes, options)[0].revision;
                chatId = 'different-dialogue-fixture-chat';
                const differentChat = readDialogueRecords(mes, options)[0].revision;
                result.revisionsDistinguish = new Set([original, swipe, edit, differentChat]).size === 4;
                result.serializable = before.every(line => Object.values(line).every(value =>
                    value === null || ['string', 'number', 'boolean'].includes(typeof value)))
                    && JSON.stringify(JSON.parse(JSON.stringify(before))) === JSON.stringify(before);
            } catch (error) { result.error = String(error.stack || error); }
            finally { if (settings && saved) Object.assign(settings, saved); }
            document.documentElement.setAttribute('data-dialogue-presentation-test', JSON.stringify(result));
        `;
        document.head.append(script);
    """)
    result = None
    try:
        for _ in range(80):
            raw = browser.execute("return document.documentElement.getAttribute('data-dialogue-presentation-test')")
            if raw:
                result = json.loads(raw)
                break
            time.sleep(0.25)
        assert result and not result.get('error') and all(value is True for value in result.values()), result
        print('Dialogue presentation live UI passed:', json.dumps(result))
    finally:
        browser.execute("""document.querySelector('#sillynpc-dialogue-presentation-test')?.remove();
            document.documentElement.removeAttribute('data-dialogue-presentation-test');""")
