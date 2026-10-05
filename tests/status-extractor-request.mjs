import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../src/tracker/extractor/status-extractor-request.js', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '').replace(/export (async )?function/g, '$1function');
function build(context) {
    const events = [], usage = [];
    const request = new Function('getContext', 'applyMacros', 'LOG_PREFIX', 'debugLog', 'SYSTEM_PROMPT',
        'describeConnection', 'extractJSON', 'safeJsonParse', 'recordUsage', 'extractMessageFromData', 'toastr', 'console',
        `${source}\nreturn requestExtraction;`)(
        () => context, value => value, '[SillyNPC]', () => {}, 'System', () => 'Connection',
        value => value, JSON.parse, (...args) => usage.push(args), raw => raw.choices[0].message.content,
        { warning: (...args) => events.push(['warning', ...args]) }, { warn: () => {} });
    return { request, events, usage };
}
const schema = { type: 'object' };
const rawReply = { choices: [{ message: { content: '{"player":{}}' } }] };

test('main API without a selected profile does not warn', async () => {
    let calls = 0;
    const { request, events, usage } = build({ generateRawData: async () => { calls++; return rawReply; } });
    assert.equal(await request('Prompt', schema, {}), '{"player":{}}');
    assert.equal(calls, 1);
    assert.deepEqual(events, []);
    assert.equal(usage.length, 1);
});

test('successful selected connection preserves its configuration without warning or fallback', async () => {
    let received;
    const { request, events, usage } = build({
        ConnectionManagerRequestService: { sendRequest: async (...args) => { received = args; return { content: { player: {} } }; } },
        generateRawData: () => assert.fail('Successful selected requests must not fall back'),
    });
    assert.deepEqual(await request('Prompt', schema, { extractionProfileId: 'reader', extractionUseSchema: true,
        extractionTemperature: '0.2', extractionMaxTokens: 500 }), { player: {} });
    assert.equal(received[0], 'reader');
    assert.equal(received[2], 500);
    assert.deepEqual(received[3], { extractData: true, includePreset: false });
    assert.deepEqual(received[4], { json_schema: schema, temperature: 0.2 });
    assert.deepEqual(events, []);
    assert.equal(usage.length, 1);
});

for (const failure of ['deleted profile', 'network failure', 'authentication failure', 'rate limit', 'schema failure', 'cancelled']) {
    test(`${failure} warns before falling back for a selected reader connection`, async () => {
        const context = { ConnectionManagerRequestService: { sendRequest: async () => { throw new Error(failure); } } };
        const { request, events, usage } = build(context);
        context.generateRawData = async () => { events.push(['main']); return rawReply; };
        assert.equal(await request('Prompt', schema, { extractionProfileId: 'reader' }), '{"player":{}}');
        assert.equal(events.length, 2);
        assert.equal(events[0][0], 'warning');
        assert.match(events[0][1], /selected reader connection failed.*main API/);
        assert.equal(events[0][2], 'SillyNPC');
        assert.deepEqual(events[1], ['main']);
        assert.equal(usage.length, 1);
    });
}

test('disabled manager warns with history scan wording and preserves scan usage on fallback', async () => {
    const context = {};
    const { request, events, usage } = build(context);
    context.generateRawData = async () => { events.push(['main']); return { player: {} }; };
    assert.deepEqual(await request('Prompt', schema, { extractionProfileId: 'scan', extractionUseSchema: true },
        'Scan system', { usageKind: 'scan' }), { player: {} });
    assert.match(events[0][1], /selected history scan connection failed.*main API/);
    assert.deepEqual(events[1], ['main']);
    assert.equal(usage[0][0], 'scan');
});

test('a failing main API still propagates its error after the fallback warning', async () => {
    const { request, events, usage } = build({
        ConnectionManagerRequestService: { sendRequest: async () => { throw new Error('Profile failed'); } },
        generateRawData: async () => { throw new Error('Main API failed'); },
    });
    await assert.rejects(request('Prompt', schema, { extractionProfileId: 'reader' }), /Main API failed/);
    assert.equal(events.length, 1);
    assert.equal(usage.length, 0);
});
