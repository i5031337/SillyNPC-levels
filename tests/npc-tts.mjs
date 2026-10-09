import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dialogueLabels } from '../src/chat/dialogue-line.js';
import { createSpeechQueue } from '../src/tts/speech-queue.js';
import { wireSpeechEvents } from '../src/tts/speech-events.js';
import { normalizeTtsSettings, resolveUnitVoice, ttsConfigError, NPC_TTS_PROVIDER } from '../src/tts/tts-settings.js';

const source = readFileSync(new URL('../src/tts/speech-units.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export function ', 'function ');
const splitSpeechLine = new Function('dialogueLabels', `${source}\nreturn splitSpeechLine;`)(dialogueLabels);

test('speaker quotes and surrounding prose become ordered, separate voices', () => {
    const line = 'Mira: “Wait.” She lowers her sword. “Stay.”';
    const match = { label: { name: 'Mira' }, dialogue: { quotedText: '“Wait.” “Stay.”' } };
    assert.deepEqual(splitSpeechLine(line, match), [
        { kind: 'dialogue', text: 'Wait.' },
        { kind: 'narration', text: 'She lowers her sword.' },
        { kind: 'dialogue', text: 'Stay.' },
    ]);
    assert.deepEqual(splitSpeechLine('The door opens.', null), [{ kind: 'narration', text: 'The door opens.' }]);
    assert.deepEqual(splitSpeechLine('Mira: “Wait.”', { label: { name: 'Mira' }, dialogue: { quotedText: '“Missing.”' } }),
        [{ kind: 'narration', text: '“Wait.”' }]);
});

test('independent speech preferences keep explicit silence and missing voices', () => {
    const config = normalizeTtsSettings({ enabled: true, endpoint: 'https://stale.example/speech',
        model: 'kokoro', narratorVoice: 'alloy', voices: ['alloy', 'nova', 'nova'] });
    assert.equal(Object.hasOwn(config, 'endpoint'), false);
    assert.equal(ttsConfigError(config, 'http://localhost/v1/audio/speech'), '');
    assert.match(ttsConfigError(config, ''), /built-in OpenAI Compatible TTS/);
    assert.deepEqual(config.voices, ['alloy', 'nova']);
    const dialogue = { kind: 'dialogue' };
    assert.equal(resolveUnitVoice({ kind: 'narration' }, config, null), 'alloy');
    assert.equal(resolveUnitVoice(dialogue, config, { presentation: { voices: {
        [NPC_TTS_PROVIDER]: { mode: 'voice', voiceId: 'nova' },
    } } }), 'nova');
    assert.equal(resolveUnitVoice(dialogue, config, { presentation: { voices: {
        [NPC_TTS_PROVIDER]: { mode: 'disabled' },
    } } }), null);
    assert.equal(resolveUnitVoice(dialogue, config, { presentation: { voices: {
        [NPC_TTS_PROVIDER]: { mode: 'voice', voiceId: 'removed' },
    } } }), null);
    assert.equal(resolveUnitVoice(dialogue, config, null), 'alloy');
});

test('speech queue prefetches requests while keeping playback ordered and bounded', async () => {
    const calls = [];
    let finishFirst;
    const queue = createSpeechQueue({
        valid: () => true,
        synthesize: async unit => { calls.push(`synth:${unit.text}`); return unit.text; },
        playAudio: unit => { calls.push(`play:${unit}`); return unit === 'first'
            ? new Promise(resolve => { finishFirst = resolve; }) : Promise.resolve(); },
    });
    const pending = queue.play(1, 'revision', [
        { text: 'first', voice: 'a' }, { text: 'second', voice: 'b' },
        { text: 'third', voice: 'c' }, { text: 'fourth', voice: 'd' },
    ]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.filter(call => call.startsWith('synth:')),
        ['synth:first', 'synth:second', 'synth:third']);
    assert.deepEqual(calls.filter(call => call.startsWith('play:')), ['play:first']);
    finishFirst(); await pending;
    assert.deepEqual(calls.filter(call => call.startsWith('synth:')),
        ['synth:first', 'synth:second', 'synth:third', 'synth:fourth']);
    assert.deepEqual(calls.filter(call => call.startsWith('play:')),
        ['play:first', 'play:second', 'play:third', 'play:fourth']);

    let release;
    const interrupted = createSpeechQueue({
        valid: () => true,
        synthesize: () => new Promise(resolve => { release = resolve; }),
        playAudio: () => { calls.push('stale audio'); return Promise.resolve(); },
    });
    const stale = interrupted.play(2, 'old', [{ text: 'old', voice: 'a' }]);
    await new Promise(resolve => setImmediate(resolve));
    interrupted.stop(); release('old'); await stale;
    assert.equal(calls.includes('stale audio'), false);
});

test('Stop aborts a prefetched request and prevents later playback', async () => {
    const calls = [];
    let finishFirst;
    const queue = createSpeechQueue({
        valid: () => true,
        synthesize: (unit, signal) => {
            calls.push(`synth:${unit.text}`);
            if (unit.text !== 'second') return Promise.resolve(unit.text);
            return new Promise((_, reject) => signal.addEventListener('abort',
                () => reject(new Error('aborted')), { once: true }));
        },
        playAudio: (audio, signal) => {
            calls.push(`play:${audio}`);
            return new Promise(resolve => {
                finishFirst = resolve;
                signal.addEventListener('abort', resolve, { once: true });
            });
        },
    });
    const pending = queue.play(1, 'revision', [
        { text: 'first', voice: 'a' }, { text: 'second', voice: 'b' }, { text: 'third', voice: 'c' },
    ]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['synth:first', 'play:first', 'synth:second']);
    queue.stop();
    finishFirst();
    await pending;
    assert.deepEqual(calls.filter(call => call.startsWith('play:')), ['play:first']);
    assert.equal(calls.includes('synth:third'), false);
});

test('automatic speech waits for a changed completed reply and rejects stale source', async () => {
    const listeners = new Map();
    const events = { on: (name, handler) => listeners.set(name, handler) };
    const fire = (name, ...args) => listeners.get(name)?.(...args);
    const types = Object.fromEntries(['GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED',
        'CHAT_CHANGED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_UPDATED']
        .map(name => [name, name]));
    let revision = 'old', token = {}, pending, stops = 0, completions = 0;
    wireSpeechEvents({ events, types, renderedEvent: 'rendered', render: () => {},
        stop: () => stops++, latestId: () => 5, revision: () => revision,
        sourceToken: () => token, defer: callback => { pending = callback; },
        complete: () => { completions++; } });
    fire('rendered'); fire(types.GENERATION_ENDED);
    assert.equal(completions, 0);
    fire(types.GENERATION_STARTED, 'normal', null, true);
    assert.equal(stops, 0);
    fire(types.GENERATION_STARTED, 'normal');
    revision = 'new';
    fire(types.MESSAGE_UPDATED); // streaming updates do not cancel the pending generation
    fire(types.GENERATION_ENDED);
    revision = 'cleaned status block'; // final DOM cleanup may revise text in the same message object
    pending(); await Promise.resolve();
    assert.equal(completions, 1);
    fire(types.GENERATION_STARTED, 'normal');
    revision = 'later'; fire(types.GENERATION_ENDED);
    token = {}; pending(); await Promise.resolve();
    assert.equal(completions, 1);
    fire(types.GENERATION_STARTED, 'normal');
    revision = 'latest'; fire(types.GENERATION_ENDED);
    fire(types.CHAT_CHANGED); pending(); await Promise.resolve();
    assert.equal(completions, 1);
    assert.equal(stops, 4);
});
