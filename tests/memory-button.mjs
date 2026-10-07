import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui/tracker/ui-memory-button.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export function ', 'function ');

function fixture() {
    const nodes = new Map();
    const settings = { enabled: true, activeSystem: 'test', statusTracker: {
        enabled: false, presets: { test: { definition: { memories: { enabled: true } } } },
    } };
    const host = { appendChild: node => nodes.set(node.id, node) };
    const document = {
        getElementById: id => id === 'leftSendForm' ? host : nodes.get(id),
        createElement: () => ({
            attributes: {}, listeners: {}, classList: { toggle() {} },
            setAttribute(name, value) { this.attributes[name] = value; },
            addEventListener(name, listener) { this.listeners[name] = listener; },
            remove() { nodes.delete(this.id); },
        }),
    };
    let busy = false;
    let calls = 0;
    let resolve;
    const notices = [];
    const refreshMemoryButton = new Function('document', 'getSettings', 'makeActivatable',
        'memoryReaderBusy', 'readMemories', 'toastr', 'LOG_PREFIX',
        `${source}\nreturn refreshMemoryButton;`)(document, () => settings, () => {},
        () => busy, options => {
            assert.equal(options.manual, true);
            calls++;
            return new Promise(done => { resolve = done; });
        }, { info: value => notices.push(value), success: value => notices.push(value) }, 'test');
    return { settings, refreshMemoryButton, notices,
        button: () => nodes.get('sillynpc-memory-button'),
        setBusy: value => { busy = value; }, calls: () => calls,
        finish: result => resolve(result) };
}

test('memory button follows System enablement independently of tracker and mounts once', () => {
    const f = fixture();
    f.refreshMemoryButton();
    const button = f.button();
    assert.equal(button.title, 'Read memories now');
    f.refreshMemoryButton();
    assert.equal(f.button(), button);
    f.setBusy(true);
    f.refreshMemoryButton();
    assert.equal(button.attributes['aria-disabled'], 'true');
    assert.equal(button.attributes['aria-busy'], 'true');
    f.settings.statusTracker.presets.test.definition.memories.enabled = false;
    f.refreshMemoryButton();
    assert.equal(f.button(), undefined);
    f.settings.statusTracker.presets.test.definition.memories.enabled = true;
    f.settings.enabled = false;
    f.refreshMemoryButton();
    assert.equal(f.button(), undefined);
});

test('manual memory button prevents duplicate requests and reports pending review', async () => {
    const f = fixture();
    f.refreshMemoryButton();
    const button = f.button();
    const request = button.listeners.click();
    assert.equal(button.attributes['aria-disabled'], 'true');
    await button.listeners.click();
    assert.equal(f.calls(), 1);
    f.finish({ ok: true, pending: 2, remainingReplies: 5 });
    await request;
    assert.equal(button.attributes['aria-disabled'], 'false');
    assert.match(f.notices[0], /2 memories awaiting review/);
    assert.match(f.notices[1], /5 unread replies remain.*again to continue/);
});
