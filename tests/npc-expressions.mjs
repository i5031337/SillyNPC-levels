import test from 'node:test';
import assert from 'node:assert/strict';
import { createExpressionEngine, lastNpcLines, selectSprite } from '../src/expressions/expression-engine.js';
import { wireExpressionEvents } from '../src/expressions/expression-events.js';
import { EventEmitter } from 'node:events';

const line = (npcId, lineIndex = 0) => ({ npcId, lineIndex, text: `Speech ${lineIndex}`, revision: 'chat/swipe/source' });
const job = (npcId, index = 0) => ({ line: line(npcId, index), config: { api: 0 } });
test('only the last dialogue line per NPC is classified, in message order', () => {
    const records = [line('a'), line('b', 1), line(null, 2), line('a', 3), { ...line('p', 4), isPersona: true }];
    assert.deepEqual(lastNpcLines(records), [records[1], records[3]]);
});
test('packs map labels and sparse fallbacks with stable variants independent of listing order', () => {
    const sprites = [{ label: 'joy', path: '/b' }, { label: 'joy', path: '/a' }, { label: 'neutral', path: '/n' }];
    assert.equal(selectSprite(sprites, 'missing', 'neutral', 'id'), '/n');
    assert.equal(selectSprite(sprites, 'missing', 'absent', 'id'), '');
    assert.equal(selectSprite([], 'joy', 'neutral', 'id'), '');
    assert.equal(selectSprite(sprites, 'joy', 'neutral', 'id'), selectSprite([...sprites].reverse(), 'joy', 'neutral', 'id'));
});
test('queue deduplicates pending and completed requests and serializes NPCs', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const requests = [], applied = [];
    const engine = createExpressionEngine({
        async classify(job) { requests.push(job.line.npcId); await gate; return 'joy'; },
        isCurrent: () => true, apply: (job, label) => applied.push([job.line.npcId, label]),
    });
    const first = engine.enqueue(job('a'));
    assert.equal(engine.enqueue(job('a')), first);
    const second = engine.enqueue(job('b'));
    await Promise.resolve(); assert.deepEqual(requests, ['a']);
    release(); await Promise.all([first, second]);
    await engine.enqueue(job('a'));
    assert.deepEqual(requests, ['a', 'b']);
    assert.deepEqual(applied, [['a', 'joy'], ['b', 'joy'], ['a', 'joy']]);
    await engine.enqueue({ ...job('a'), config: { api: 3 } });
    assert.equal(requests.length, 3);
    await engine.enqueue({ ...job('a'), sprites: [{ label: 'joy' }] });
    assert.equal(requests.length, 4);
});
test('changed chat, swipe, source, configuration or reset prevents pending results from applying', async () => {
    for (const reset of [false, true]) {
        let resolve, current = true;
        const applied = [];
        const engine = createExpressionEngine({ classify: () => new Promise(done => { resolve = done; }),
            isCurrent: () => current, apply: value => applied.push(value) });
        const task = engine.enqueue(job('a'));
        await Promise.resolve();
        if (reset) engine.reset(); else current = false;
        resolve('joy'); await task;
        assert.deepEqual(applied, []);
    }
});
test('obsolete queued jobs are skipped and failed classifiers do not block later NPCs', async () => {
    const applied = [];
    const engine = createExpressionEngine({
        classify: async job => { if (job.line.npcId === 'bad') throw new Error('offline'); return 'neutral'; },
        isCurrent: job => job.line.npcId !== 'stale', apply: job => applied.push(job.line.npcId),
    });
    await assert.rejects(engine.enqueue(job('bad')), /offline/);
    await engine.enqueue(job('stale'));
    await engine.enqueue(job('good'));
    assert.deepEqual(applied, ['good']);
});

test('only changed completed foreground replies schedule work; history, quiet, stopped and obsolete work stay idle', () => {
    const events = new EventEmitter();
    const types = Object.fromEntries(['GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED',
        'CHAT_CHANGED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED'].map(name => [name, name]));
    let identity = 'old', renders = 0;
    const completed = [], deferred = [];
    wireExpressionEvents({ events, types, renderedEvent: 'render', render: () => renders++, reset: () => {},
        latestId: () => 1, revision: () => identity, defer: fn => deferred.push(fn), complete: id => completed.push(id) });
    events.emit('render'); events.emit(types.GENERATION_ENDED);
    events.emit(types.GENERATION_STARTED, 'quiet'); identity = 'quiet'; events.emit(types.GENERATION_ENDED);
    events.emit(types.GENERATION_STARTED, 'normal', {}, true); identity = 'dry'; events.emit(types.GENERATION_ENDED);
    assert.equal(renders, 1); assert.equal(deferred.length, 0);
    events.emit(types.GENERATION_STARTED, 'normal'); events.emit(types.GENERATION_ENDED);
    assert.equal(deferred.length, 0);
    events.emit(types.GENERATION_STARTED, 'normal'); identity = 'new'; events.emit(types.GENERATION_ENDED);
    deferred.pop()(); assert.deepEqual(completed, [1]);
    events.emit(types.GENERATION_ENDED); assert.equal(deferred.length, 0);
    for (const event of [types.CHAT_CHANGED, types.MESSAGE_SWIPED, types.MESSAGE_EDITED, types.MESSAGE_DELETED, types.GENERATION_STOPPED]) {
        events.emit(types.GENERATION_STARTED, 'swipe'); identity += 'x'; events.emit(types.GENERATION_ENDED);
        events.emit(event); deferred.pop()();
    }
    events.emit(types.GENERATION_STARTED, 'continue'); identity += 'x'; events.emit(types.GENERATION_STOPPED);
    events.emit(types.GENERATION_ENDED);
    assert.deepEqual(completed, [1]); assert.equal(deferred.length, 0);
});

test('tracker cleanup before the deferred frame uses the final revision without accepting replacement messages', () => {
    const events = new EventEmitter();
    const types = Object.fromEntries(['GENERATION_STARTED', 'GENERATION_STOPPED', 'GENERATION_ENDED',
        'CHAT_CHANGED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED'].map(name => [name, name]));
    let message = { text: 'old' }, deferred;
    const completed = [];
    wireExpressionEvents({ events, types, renderedEvent: 'render', render: () => {}, reset: () => {},
        latestId: () => 0, revision: () => message.text, sourceToken: () => message,
        defer: fn => { deferred = fn; }, complete: () => completed.push(message.text) });
    events.emit(types.GENERATION_STARTED, 'normal'); message.text = 'new with status block';
    events.emit(types.GENERATION_ENDED); message.text = 'new cleaned'; deferred();
    assert.deepEqual(completed, ['new cleaned']);
    events.emit(types.GENERATION_STARTED, 'regenerate'); message.text = 'replacement reply';
    events.emit(types.GENERATION_ENDED); message = { text: 'different chat message' }; deferred();
    assert.deepEqual(completed, ['new cleaned']);
});
