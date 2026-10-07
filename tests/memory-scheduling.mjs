import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

function harness() {
    const context = { chat: [{ mes: 'Existing reply' }] };
    const timers = new Map();
    let next = 0, generation = false, extraction = false, enabled = true, reads = 0;
    const deps = {
        getContext: () => context, getSettings: () => ({ enabled }),
        isGenerating: () => generation, isExtractionRunning: () => extraction,
        getAllCharacters: () => [], loadStateFromMetadata: () => ({}), saveStateToMetadata: () => {},
        saveChatSoon: () => {}, getPendingChanges: () => [], getLooseNotes: () => [],
        getRefusedValues: () => [], setPendingChanges: () => {}, appendPendingMemoryChanges: () => {},
        requestExtraction: () => {}, coerceToUpdate: value => value, syncProfileToLore: async () => {},
        LOG_PREFIX: 'test', createMemoryService: () => ({ busy: () => false, reconcile: () => {},
            read: async () => { reads++; return { ok: true }; } }),
        setTimeout: fn => { const id = ++next; timers.set(id, fn); return id; },
        clearTimeout: id => timers.delete(id),
    };
    const source = readFileSync(new URL('../src/memory/memory-reader.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replaceAll('export ', '');
    const api = new Function(...Object.keys(deps), `${source}\nreturn { resetMemorySchedule, scheduleMemoryRead };`)(...Object.values(deps));
    const tick = async () => {
        const tasks = [...timers.values()]; timers.clear();
        for (const fn of tasks) await fn();
    };
    api.resetMemorySchedule();
    return { api, context, tick, timers, reads: () => reads,
        setBusy: (g, e) => { generation = g; extraction = e; }, disable: () => enabled = false };
}

test('historical renders are ignored and new reply renders schedule only once', async () => {
    const h = harness();
    h.api.scheduleMemoryRead(0);
    assert.equal(h.timers.size, 0);
    h.context.chat.push({ mes: 'New reply' });
    h.api.scheduleMemoryRead(1); h.api.scheduleMemoryRead(1);
    assert.equal(h.timers.size, 1);
    await h.tick(); assert.equal(h.reads(), 1);
});

test('memory scheduling waits for both generation and tracker completion', async () => {
    const h = harness(); h.context.chat.push({ mes: 'New reply' });
    h.setBusy(true, true); h.api.scheduleMemoryRead(1);
    await h.tick(); assert.equal(h.reads(), 0);
    h.setBusy(false, true); await h.tick(); assert.equal(h.reads(), 0);
    h.setBusy(false, false); await h.tick(); assert.equal(h.reads(), 1);
});

test('chat switches cancel requests and deleted reply indexes can be reused', async () => {
    const h = harness(); h.context.chat.push({ mes: 'Discarded reply' });
    h.api.scheduleMemoryRead(1);
    h.context.chat.pop(); h.api.resetMemorySchedule();
    assert.equal(h.timers.size, 0);
    h.context.chat.push({ mes: 'Replacement reply' }); h.api.scheduleMemoryRead(1);
    await h.tick(); assert.equal(h.reads(), 1);
    h.context.chat.push({ mes: 'Another reply' }); h.api.scheduleMemoryRead(2);
    h.context.chat = [{ mes: 'Other chat' }]; await h.tick();
    assert.equal(h.reads(), 1);
});

test('disabling the extension cancels queued memory work', async () => {
    const h = harness(); h.context.chat.push({ mes: 'New reply' });
    h.api.scheduleMemoryRead(1); h.disable(); await h.tick();
    assert.equal(h.reads(), 0); assert.equal(h.timers.size, 0);
});
