import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { automaticFillStages } from '../src/prompts/fill-preset.js';

const source = readFileSync(new URL('../src/ui/characters/ui-fill-new.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export async function', 'async function');

function fixture() {
    const cards = [], calls = [], errors = [];
    let fill = async () => {};
    const deps = {
        getContext: () => ({ getCurrentChatId: () => 'chat' }), LOG_PREFIX: '[test]',
        createCharacter: name => { const card = { id: name, name }; cards.push(card); return card; },
        findCardForName: name => cards.find(card => card.name.toLowerCase() === name.toLowerCase()
            || card.alias === name),
        addCharacterToChat: id => calls.push(['include', id]),
        triggerReprocess: () => calls.push(['redraw']),
        fillCharacter: async (card, options) => { calls.push(['fill', card, options]); await fill(card, options); },
        console: { error() {} }, toastr: { error: message => errors.push(message) },
    };
    const run = new Function(...Object.keys(deps), `${source}; return fillNewCharacter;`)(...Object.values(deps));
    return { run, cards, calls, errors, setFill: action => { fill = action; } };
}

test('manual profile fill creates a named chat card and uses the portrait automatic preset', async () => {
    const f = fixture();
    let refreshes = 0;
    f.setFill(async (card, options) => options.onSave());
    const card = await f.run(' Mira ', { onSave: () => refreshes++ });
    assert.deepEqual(f.cards, [{ id: 'Mira', name: 'Mira' }]);
    assert.equal(card, f.cards[0]);
    assert.deepEqual(f.calls[0], ['include', 'Mira']);
    assert.equal(f.calls[2][0], 'fill');
    assert.equal(f.calls[2][2].preset, 'automatic');
    assert.equal(refreshes, 2);
});

test('tracker and portrait requests share a fill lock and stale controls reuse cards and aliases', async () => {
    const f = fixture();
    let finish;
    f.setFill(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.run('Mira');
    await f.run('mIRA');
    assert.equal(f.cards.length, 1);
    assert.equal(f.calls.filter(call => call[0] === 'fill').length, 1);
    finish(); await pending;
    f.cards[0].alias = 'Captain';
    f.setFill(async () => {});
    await f.run('Captain');
    assert.equal(f.cards.length, 1);
});

test('blank names do nothing and a failed fill releases its lock for retry', async () => {
    const f = fixture();
    await f.run(' ');
    assert.equal(f.calls.length, 0);
    f.setFill(async () => { throw new Error('Offline'); });
    await f.run('Mira');
    assert.equal(f.errors.length, 1);
    f.setFill(async () => {});
    await f.run('Mira');
    assert.equal(f.cards.length, 1);
    assert.equal(f.calls.filter(call => call[0] === 'fill').length, 2);
});

test('automatic Fill draws missing portraits by default and keeps completed stages', () => {
    const audit = {
        lore: { done: true }, image: { done: false },
    };
    assert.deepEqual(automaticFillStages(audit), {
        lore: false, image: true,
    });
    assert.equal(automaticFillStages(audit, false).image, false);
    assert.equal(automaticFillStages({ ...audit, image: { done: true } }).image, false);
});
