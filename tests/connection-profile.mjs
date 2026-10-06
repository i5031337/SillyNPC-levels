import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { customProfilePayload, profileContext } from './helpers/connection-profile.mjs';

const profile = { api: 'custom', preset: 'Model preset' };
const preset = { custom_include_body: 'temperature: 0.7\nmax_tokens: 900\nmodel: {{model}}',
    custom_exclude_body: '- top_p', custom_include_headers: 'X-Model: {{model}}' };
const expected = { custom_include_body: 'temperature: 0.7\nmax_tokens: 900\nmodel: fixture-model',
    custom_exclude_body: '- top_p', custom_include_headers: 'X-Model: fixture-model' };
const contextFor = (selected, saved = preset) => profileContext({ presets: { 'Model preset': saved }, ConnectionManagerRequestService: { getProfile: id => {
    assert.equal(id, 'selected'); return selected;
} } });

test('assigned preset parameters retain conflicting YAML, substitute macros, and leave saved data unchanged', () => {
    const before = structuredClone({ profile, preset });
    assert.deepEqual(customProfilePayload(contextFor(profile), 'selected'), expected);
    assert.deepEqual({ profile, preset }, before);
});
test('empty fields remain explicit and missing fields do not inherit active connection parameters', () => {
    const context = contextFor(profile, { custom_include_body: '' });
    context.extensionSettings = { connectionManager: { selectedProfile: 'active' } };
    assert.deepEqual(customProfilePayload(context, 'selected'), { custom_include_body: '' });
    assert.equal(context.extensionSettings.connectionManager.selectedProfile, 'active');
});
test('Additional Parameters are restricted to the Custom chat-completion source', () => {
    for (const api of ['openai', 'claude', undefined]) {
        assert.deepEqual(customProfilePayload(contextFor({ ...profile, api }), 'selected'), {});
    }
});

test('unassigned presets and absent preset fields produce no Additional Parameters', () => {
    assert.deepEqual(customProfilePayload(contextFor({ api: 'custom' }), 'selected'), {});
    assert.deepEqual(customProfilePayload(contextFor(profile, {}), 'selected'), {});
});
test('a missing assigned preset fails explicitly', () => {
    assert.throws(() => customProfilePayload(contextFor(profile, null), 'selected'), /Completion preset.*unavailable/);
});
test('copies only Additional Parameters, leaving unrelated preset settings out of the request', () => {
    assert.deepEqual(customProfilePayload(contextFor(profile, { ...preset, temperature: 1.8,
        top_p: 0.3, chat_completion_source: 'claude', model: 'other' }), 'selected'), expected);
});

const loreSource = (await readFile(new URL('../src/api/api-lore-generate.js', import.meta.url), 'utf8'));
const requestSource = loreSource.slice(loreSource.indexOf('export async function requestLore'),
    loreSource.indexOf('/**\n * Generates lore tags')).replace('export async function', 'async function');
test('lore forwards assigned preset parameters while retaining raw response and truncation handling', async () => {
    const context = contextFor(profile);
    context.extensionSettings = { connectionManager: { profiles: [{ ...profile, id: 'selected', name: 'Custom' }] } };
    context.ConnectionManagerRequestService.validateProfile = () => ({ source: 'custom', selected: 'openai' });
    let received;
    context.ConnectionManagerRequestService.sendRequest = async (...args) => {
        received = args; return { choices: [{ message: { content: 'Lore' }, finish_reason: 'length' }] };
    };
    context.generateRawData = () => assert.fail('Successful profile must not fall back');
    const request = new Function('getContext', 'getSettings', 'debugLog', 'describeConnection', 'promptText',
        'customProfilePayload', 'extractMessageFromData', 'recordUsage', 'loreReplyWasTruncated',
        `let lastLoreConnection; ${requestSource}\nreturn requestLore;`)(
        () => context, () => ({ loreProfileId: 'selected', loreMaxTokens: 400 }), () => {}, () => 'Custom',
        () => 'System', customProfilePayload, raw => raw.choices[0].message.content, () => {},
        raw => raw.choices[0].finish_reason === 'length');
    assert.deepEqual(await request('Prompt'), { text: 'Lore', truncated: true });
    assert.equal(received[2], 400);
    assert.deepEqual(received[3], { extractData: false, includePreset: false });
    assert.deepEqual(received[4], expected);
});
