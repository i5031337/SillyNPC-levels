import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const notesSource = readFileSync(new URL('../src/story/history-notes.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replaceAll('export function ', 'function ');
const { withoutWorldNote, stripWorldNote } = new Function(
    'GLOBALS_KEY', `${notesSource}\nreturn { withoutWorldNote, stripWorldNote };`,
)('sillynpc_globals');

const historySource = readFileSync(new URL('../src/tracker/status-history.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replaceAll('export function ', 'function ')
    .replace('export const RAW_STATUS_KEY', 'const RAW_STATUS_KEY');
const { stripStatusBlockFromMessage } = new Function(
    'parseMessageForUpdates', `${historySource}\nreturn { stripStatusBlockFromMessage };`,
)(text => {
    const start = text.indexOf('<status_update>');
    const cleanedText = start < 0 ? text : text.slice(0, start).trimEnd();
    return { cleanedText, matchLength: text.length - cleanedText.length };
});

test('a copied world note is kept when it is the whole reply', () => {
    const message = { mes: '[Location: Inn]', swipes: ['[Location: Inn]'], swipe_id: 0 };
    assert.equal(withoutWorldNote(message.mes, ['Location']), null);
    assert.equal(stripWorldNote(message, ['Location']), false);
    assert.equal(message.mes, '[Location: Inn]');
    assert.equal(message.swipes[0], '[Location: Inn]');

    message.mes = '[Location: Inn]\nA door opens.';
    assert.equal(stripWorldNote(message, ['Location']), true);
    assert.equal(message.mes, 'A door opens.');
});

test('a status block cannot erase the saved reply or its swipe', () => {
    const onlyStatus = '<status_update>{"player":{}}</status_update>';
    const message = { mes: onlyStatus, swipes: [onlyStatus], swipe_id: 0 };
    assert.equal(stripStatusBlockFromMessage(message).changed, false);
    assert.equal(message.mes, onlyStatus);
    assert.equal(message.swipes[0], onlyStatus);

    message.mes = `A door opens.\n${onlyStatus}`;
    assert.equal(stripStatusBlockFromMessage(message).changed, true);
    assert.equal(message.mes, 'A door opens.');
});

const namesSource = readFileSync(new URL('../src/entry/entry-generation-names.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replaceAll('export function ', 'function ');

test('story generation permits a player-labelled reply only until cleanup ends', () => {
    const powerUser = { allow_name1_display: false };
    const settings = { enabled: true, dialogueFormatEnabled: true };
    const { allowStoryPlayerDialogue, restorePlayerDialogueSetting } = new Function(
        'power_user', 'getSettings',
        `${namesSource}\nreturn { allowStoryPlayerDialogue, restorePlayerDialogueSetting };`,
    )(powerUser, () => settings);

    allowStoryPlayerDialogue('normal', {}, true);
    assert.equal(powerUser.allow_name1_display, false);
    allowStoryPlayerDialogue('quiet', {}, false);
    assert.equal(powerUser.allow_name1_display, false);

    allowStoryPlayerDialogue('normal', {}, false);
    assert.equal(powerUser.allow_name1_display, true);
    // A nested generation must not lose the original setting.
    allowStoryPlayerDialogue('normal', {}, false);
    restorePlayerDialogueSetting();
    assert.equal(powerUser.allow_name1_display, false);

    powerUser.allow_name1_display = true;
    allowStoryPlayerDialogue('normal', {}, false);
    restorePlayerDialogueSetting();
    assert.equal(powerUser.allow_name1_display, true);
});
