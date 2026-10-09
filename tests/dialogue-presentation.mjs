import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { cardForDialogueName, dialogueQuotes } from '../src/chat/dialogue-discovery.js';

const cards = [
    { id: 'captain', name: 'Ágata', aliases: [{ pattern: 'Captain' }, { pattern: 'Officer [0-9]+', isRegex: true }] },
    { id: 'other', name: 'Other', aliases: [{ pattern: '[', isRegex: true }] },
];

test('dialogue extraction excludes prose, actions, following speakers, and incomplete streams', () => {
    assert.deepEqual(dialogueQuotes('"Hello." She smiles at the newcomer.'), {
        text: 'Hello.', quotedText: '"Hello."',
    });
    assert.deepEqual(dialogueQuotes('"Hello."\nOther: "Goodbye."'), {
        text: 'Hello.', quotedText: '"Hello."',
    });
    assert.deepEqual(dialogueQuotes('"Hello." *waves*'), { text: 'Hello.', quotedText: '"Hello."' });
    assert.deepEqual(dialogueQuotes('"Hello." *waves and mouths "quietly"* "Stay."'), {
        text: 'Hello. Stay.', quotedText: '"Hello." "Stay."',
    });
    assert.equal(dialogueQuotes('"Still arriving'), null);
    assert.equal(dialogueQuotes('no dialogue'), null);
    assert.equal(dialogueQuotes('"Finished." "Not finished'), null);
});

test('accepted quotation styles and escaped quotes retain the text needed for narration filters', () => {
    for (const [open, close] of [['"', '"'], ['“', '”'], ['«', '»'], ['「', '」'], ['『', '』'], ['＂', '＂']]) {
        const quotedText = `${open}Welcome.${close}`;
        assert.deepEqual(dialogueQuotes(` ${quotedText} “Stay.”`), {
            text: 'Welcome. Stay.', quotedText: `${quotedText} “Stay.”`,
        });
    }
    const quotedText = '"Say \\"hello\\"."';
    assert.deepEqual(dialogueQuotes(quotedText), { text: 'Say \\"hello\\".', quotedText });
});

test('speaker resolution follows highlight case sensitivity and anchored aliases', () => {
    assert.equal(cardForDialogueName('Ágata', cards).id, 'captain');
    assert.equal(cardForDialogueName('Captain', cards).id, 'captain');
    assert.equal(cardForDialogueName('CAPTAIN', cards), null);
    assert.equal(cardForDialogueName('CAPTAIN', cards, true).id, 'captain');
    assert.equal(cardForDialogueName('Officer 24', cards).id, 'captain');
    assert.equal(cardForDialogueName('Former Officer 24', cards), null);
    assert.equal(cardForDialogueName('Unknown', cards), null);
});

test('same-name speakers resolve to their chat card and display renames retain identity', () => {
    const local = { id: 'local', name: 'Ágata', aliases: [] };
    const secondChat = { id: 'second', name: 'Ágata', aliases: [] };
    assert.equal(cardForDialogueName('Ágata', [local, ...cards]).id, 'local');
    assert.equal(cardForDialogueName('Ágata', [secondChat, ...cards]).id, 'second');
    local.name = 'Captain Ágata';
    assert.equal(cardForDialogueName('Captain Ágata', [local]).id, 'local');
});

const revisionSource = readFileSync(new URL('../src/chat/dialogue-presentation.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export function ', 'function ');
const dialogueRevision = new Function(`${revisionSource}\nreturn dialogueRevision;`)();

test('revision identities separate chat, character, group, message, swipe, edits, and display text', () => {
    const context = { getCurrentChatId: () => 'chat A', characterId: 1,
        chat: [{ swipe_id: 0, mes: 'A: "Hi."' }] };
    const first = dialogueRevision(context, 0);
    assert.equal(dialogueRevision(context, 0), first);
    for (const change of [
        c => { c.getCurrentChatId = () => 'chat B'; },
        c => { c.characterId = 2; },
        c => { c.groupId = 'group'; },
        c => { c.chat[0].swipe_id = 1; },
        c => { c.chat[0].mes = 'A: "Bye."'; },
        c => { c.chat[0].extra = { display_text: 'A: "Bonjour."' }; },
    ]) {
        const changed = { ...context, chat: structuredClone(context.chat) };
        change(changed);
        assert.notEqual(dialogueRevision(changed, 0), first);
    }
    assert.notEqual(dialogueRevision(context, 1), first);
});
