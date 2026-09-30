import assert from 'node:assert/strict';
import test from 'node:test';
import { dialogueLabels } from '../src/chat/dialogue-line.js';

test('plain speaker lines work without a character card or Markdown', () => {
    const text = 'Her face is framed by gold-rimmed glasses.\n\n'
        + 'Chloe: "Welcome to the campus, freshman!"\n\n'
        + 'She offers a friendly smile.';
    assert.deepEqual(dialogueLabels(text).map(({ name }) => name), ['Chloe']);
    assert.deepEqual(dialogueLabels('Chloe: “Welcome.”').map(({ name }) => name), ['Chloe']);
});

test('only line-start name and quoted dialogue count as a speaker', () => {
    assert.deepEqual(dialogueLabels('She says, Chloe: "Welcome."'), []);
    assert.deepEqual(dialogueLabels('HP: 10/10'), []);
    assert.deepEqual(dialogueLabels('**Chloe**: "Welcome."'), []);
    assert.deepEqual(dialogueLabels('Chloe: "Welcome."', false), []);
    assert.deepEqual(dialogueLabels('Chloe: '), []);
    assert.deepEqual(dialogueLabels('Chloe: ', true, true).map(({ name }) => name), ['Chloe']);
    assert.deepEqual(dialogueLabels('She says, Chloe: ', true, true), []);
    assert.deepEqual(dialogueLabels('\nChloe: ', false, true).map(({ name }) => name), ['Chloe']);
});
