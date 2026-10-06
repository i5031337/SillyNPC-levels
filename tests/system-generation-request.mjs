import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { customProfilePayload, profileContext } from './helpers/connection-profile.mjs';
const source = (await readFile(new URL('../src/generation/request.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '').replace('export function', 'function');
const build = (context, usage = () => {}) => new Function('getContext', 'recordUsage', 'extractMessageFromData', 'customProfilePayload', `${source}\nreturn generationRequestAdapter;`)(() => profileContext(context), usage, raw => raw.choices[0].message.content, customProfilePayload);
const args = { systemPrompt: 'System', userPrompt: 'Premise', schema: { type: 'object' }, maxTokens: 3200, signal: new AbortController().signal };
test('System generation forwards Additional Parameters from its captured connection preset', async () => {
    let received;
    const request = build({ ConnectionManagerRequestService: {
        getProfile: id => { assert.equal(id, 'custom'); return { api: 'custom', preset: 'Model preset' }; },
        sendRequest: async (...values) => { received = values; return { content: {} }; },
    }, presets: { 'Model preset': { custom_include_body: 'max_tokens: 900', custom_exclude_body: '',
            custom_include_headers: 'X-Model: {{model}}' } }, generateRawData: () => assert.fail('No fallback') })({ extractionProfileId: 'custom' });
    await request(args);
    assert.deepEqual(received[4], { custom_include_body: 'max_tokens: 900', custom_exclude_body: '',
        custom_include_headers: 'X-Model: fixture-model' });
    assert.equal(received[3].signal, args.signal);
});
test('selected profile receives schema, budget, signal and dedicated prompts; preferences are captured', async () => {
    let received, counted;
    const context = { ConnectionManagerRequestService: { sendRequest: async (...values) => { received = values; return { content: { section: {}, assumptions: [] } }; } }, generateRawData: () => { throw new Error('No fallback'); } };
    const tracker = { extractionProfileId: 'local', extractionUseSchema: true, extractionTemperature: '0.2' };
    const request = build(context, (...values) => { counted = values; })(tracker);
    tracker.extractionProfileId = 'changed'; tracker.extractionUseSchema = false;
    assert.deepEqual(await request(args), { section: {}, assumptions: [] });
    assert.equal(received[0], 'local'); assert.equal(received[2], 3200);
    assert.equal(received[3].includePreset, false); assert.equal(received[3].signal, args.signal);
    assert.deepEqual(received[4], { json_schema: args.schema, temperature: 0.2 });
    assert.equal(counted[0], 'system');
});
test('profile failures never switch to main API and aborted requests never dispatch', async () => {
    let main = 0, selected = 0;
    const context = { ConnectionManagerRequestService: { sendRequest: async () => { selected++; throw new Error('Profile gone'); } }, generateRawData: () => { main++; } };
    const request = build(context)({ extractionProfileId: 'local' });
    await assert.rejects(request(args), /Profile gone/); assert.equal(main, 0);
    const aborted = new AbortController(); aborted.abort();
    await assert.rejects(request({ ...args, signal: aborted.signal }), { name: 'AbortError' });
    assert.equal(selected, 1);
});
test('main API supports both structured and ordinary text paths', async () => {
    let parameters;
    const plain = build({ generateRawData: async params => { parameters = params; return { choices: [{ message: { content: '{"section": {}, "assumptions": []}' } }] }; } })({});
    assert.equal(typeof await plain(args), 'string'); assert.equal(parameters.jsonSchema, null);
    const structured = build({ generateRawData: async params => { parameters = params; return { section: {}, assumptions: [] }; } })({ extractionUseSchema: true });
    assert.deepEqual(await structured(args), { section: {}, assumptions: [] }); assert.deepEqual(parameters.jsonSchema, args.schema);
});
