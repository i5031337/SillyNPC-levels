import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/tracker/extractor/status-extraction-report.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replaceAll('export function ', 'function ');

function harness() {
    const context = { chat: [{ swipe_id: 0, extra: {} }] };
    let saves = 0;
    const api = new Function('getContext', 'saveChatSoon', 'appliedChangesForCurrentSwipe', `${source}\nreturn {
        getExtractionReport, startExtractionReport, finishExtractionReport,
        clearExtractionReport, extractionSwipe,
    };`)(() => context, () => saves++, id => context.chat[id]?.extra?.sillynpc_applied || []);
    return { context, api, saves: () => saves };
}

test('reader status stays with the reply and survives a redraw', () => {
    const { context, api, saves } = harness();
    const message = api.startExtractionReport(0);
    assert.deepEqual(api.getExtractionReport(0), { status: 'running' });

    const report = { swipe: 0, status: 'done', summary: '1 applied', output: { why: { HP: 'Hit' } } };
    context.chat[0].extra.sillynpc_applied = [{}];
    api.finishExtractionReport(0, message, report);
    assert.deepEqual(api.getExtractionReport(0), report);
    assert.equal(saves(), 1);

    context.chat[0].swipe_id = 1;
    assert.equal(api.getExtractionReport(0), null);
    context.chat[0].swipe_id = 0;
    assert.deepEqual(api.getExtractionReport(0), report);
    api.clearExtractionReport(0);
    assert.equal(api.getExtractionReport(0), null);
});

test('review counts follow live rows after apply and reload while diagnostics survive', () => {
    const { context, api } = harness();
    const message = api.startExtractionReport(0);
    message.extra.sillynpc_pending = Array.from({ length: 106 }, () => ({}));
    api.finishExtractionReport(0, message, { swipe: 0, status: 'done',
        summary: '0 applied · 106 awaiting review · 2 warnings · 1 NPC profile(s) generated', warnings: ['Kept'], output: {} });
    assert.match(api.getExtractionReport(0).summary, /^0 applied · 106 awaiting review/);
    message.extra.sillynpc_applied = message.extra.sillynpc_pending;
    delete message.extra.sillynpc_pending;
    assert.match(api.getExtractionReport(0).summary, /^106 applied · 0 awaiting review/);
    context.chat[0] = JSON.parse(JSON.stringify(message));
    assert.match(api.getExtractionReport(0).summary, /0 awaiting review · 2 warnings · 1 NPC profile/);
    assert.deepEqual(api.getExtractionReport(0).warnings, ['Kept']);
    context.chat[0].extra.sillynpc_applied = [];
    context.chat[0].extra.sillynpc_reader_report.reviewedMemories = 2;
    assert.match(api.getExtractionReport(0).summary, /^2 applied · 0 awaiting review/);
});

test('late reader result cannot attach to a replacement message or swipe', () => {
    const { context, api, saves } = harness();
    const oldMessage = api.startExtractionReport(0);
    context.chat[0] = { swipe_id: 0, extra: {} };
    api.finishExtractionReport(0, oldMessage,
        { swipe: 0, status: 'done', summary: 'old', output: {} });
    assert.equal(api.getExtractionReport(0), null);
    assert.equal(saves(), 0);

    const current = api.startExtractionReport(0);
    context.chat[0].swipe_id = 1;
    api.finishExtractionReport(0, current,
        { swipe: 0, status: 'done', summary: 'old swipe', output: {} });
    assert.equal(api.getExtractionReport(0), null);
    assert.equal(saves(), 0);
});
