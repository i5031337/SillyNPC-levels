import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { defaultTrackerSettings } from '../src/core/settings-tracker-defaults.js';

const source = readFileSync(new URL('../src/tracker/extractor/status-npc-profiles.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export async function', 'async function');

function fixture() {
    const settings = { statusTracker: { autoGenerateNpcProfiles: true }, activeSystem: 'Story', autoPortraitOnFill: false };
    const cards = [{ id: 'existing', name: 'Known', profile: { appearance: 'Saved' } }];
    const state = { player: { name: 'Player' }, characters: ['Mira', 'Elza', 'Known', 'Player', 'Excluded']
        .map(name => ({ name, npcTemplateId: 'merchant', stats: { HP: '7/10' }, collections: {} })) };
    const fields = [{ id: 'appearance', label: 'Appearance' }];
    const calls = [];
    const warnings = [];
    const context = { getCurrentChatId: () => 'chat1' };
    let current = true;
    let imageReply = async card => `/images/${card.name}.png`;
    let reply = async () => ({ content: 'generated' });
    const dependencies = {
        getContext: () => context, getSettings: () => settings,
        saveSettings: () => calls.push('save'), LOG_PREFIX: '[test]',
        profileFieldsForCard: () => fields,
        createCharacter: name => {
            const card = { id: name, name, profile: {} };
            cards.push(card);
            return card;
        },
        findCharacterRecord: id => cards.find(card => card.id === id),
        findCardForName: name => cards.find(card => card.name === name),
        loadStateFromMetadata: () => state,
        mayJoinScene: name => name !== 'Excluded',
        resolveCanonicalName: name => name === 'Alias' ? 'Mira' : name,
        generateLoreContent: async card => { calls.push(`generate:${card.name}`); return reply(card); },
        parseGeneratedProfileFields: content => content === 'generated' ? { appearance: 'Blue coat' } : null,
        syncProfileToLore: async (card, memories, { isCurrent }) => {
            assert.equal(isCurrent(), true);
            calls.push(`lore:${card.name}`);
        },
        generateCharacterImageLogic: async card => {
            calls.push(`image:${card.name}`);
            return imageReply(card);
        },
        triggerReprocess: () => calls.push('redraw'),
        toastr: { warning: message => warnings.push(message) }, console: { warn() {} },
    };
    const run = new Function(...Object.keys(dependencies), `${source}\nreturn generateNewNpcProfiles;`)
        (...Object.values(dependencies));
    return { settings, cards, state, fields, calls, warnings, context,
        run: names => run(names, () => current),
        setReply: value => { reply = value; }, setImageReply: value => { imageReply = value; }, invalidate: () => { current = false; } };
}

test('automatic profiles are opt-in and require an open chat', async () => {
    assert.equal(defaultTrackerSettings.autoGenerateNpcProfiles, false);
    const f = fixture();
    f.settings.statusTracker.autoGenerateNpcProfiles = false;
    assert.deepEqual(await f.run(['Mira']), { generated: 0, failed: 0 });
    f.settings.statusTracker.autoGenerateNpcProfiles = true;
    f.context.getCurrentChatId = () => undefined;
    await f.run(['Mira']);
    assert.deepEqual(f.calls, []);
});

test('new admitted NPCs generate once; aliases, existing cards and the player are skipped', async () => {
    const f = fixture();
    assert.deepEqual(await f.run(['Mira', 'Alias', 'Known', 'Player', 'Excluded', 'Not admitted']),
        { generated: 1, failed: 0 });
    const mira = f.cards.find(card => card.name === 'Mira');
    assert.equal(mira.npcTemplateId, 'merchant');
    assert.deepEqual(mira.statusOverrides, { HP: '7/10' });
    assert.equal(mira.profile.appearance, 'Blue coat');
    assert.equal(f.cards[0].profile.appearance, 'Saved');
    assert.deepEqual(await f.run(['Mira']), { generated: 0, failed: 0 });
    assert.equal(f.calls.filter(call => call === 'generate:Mira').length, 1);
});

test('chat or reply changes during generation discard the profile and stop subsequent requests', async () => {
    const f = fixture();
    f.setReply(async () => { f.invalidate(); return { content: 'generated' }; });
    await f.run(['Mira', 'Elza']);
    assert.deepEqual(f.cards.find(card => card.name === 'Mira').profile, {});
    assert.equal(f.cards.some(card => card.name === 'Elza'), false);
    assert.equal(f.calls.some(call => call.startsWith('lore:')), false);
});

test('manual profile edits take precedence while the lore writer is running', async () => {
    const f = fixture();
    f.setReply(async card => { card.profile.appearance = 'Manual'; return { content: 'generated' }; });
    await f.run(['Mira']);
    assert.equal(f.cards.find(card => card.name === 'Mira').profile.appearance, 'Manual');
});

test('a changed System or template field selection discards the generated result', async () => {
    const f = fixture();
    f.setReply(async () => { f.fields.push({ id: 'history' }); return { content: 'generated' }; });
    await f.run(['Mira']);
    assert.deepEqual(f.cards.find(card => card.name === 'Mira').profile, {});
    assert.equal(f.calls.some(call => call.startsWith('lore:')), false);
});

test('an unusable reply leaves a retryable card and does not prevent the next NPC profile', async () => {
    const f = fixture();
    f.setReply(async card => ({ content: card.name === 'Mira' ? '' : 'generated' }));
    assert.deepEqual(await f.run(['Mira', 'Elza']), { generated: 1, failed: 1 });
    assert.equal(f.warnings.length, 1);
    assert.deepEqual(f.cards.find(card => card.name === 'Mira').profile, {});
    assert.equal(f.cards.find(card => card.name === 'Elza').profile.appearance, 'Blue coat');
});


test('automatic portraits follow the shared Fill setting after the profile is saved', async () => {
    const disabled = fixture();
    await disabled.run(['Mira']);
    assert.equal(disabled.calls.some(call => call.startsWith('image:')), false);
    const f = fixture();
    f.settings.autoPortraitOnFill = true;
    assert.deepEqual(await f.run(['Mira']), { generated: 1, failed: 0 });
    const card = f.cards.find(card => card.name === 'Mira');
    assert.equal(card.imageUrl, '/images/Mira.png');
    assert.deepEqual(card.images, ['/images/Mira.png']);
    assert.ok(f.calls.indexOf('lore:Mira') < f.calls.indexOf('image:Mira'));
});

test('portrait failure preserves the profile and allows the next NPC to generate', async () => {
    const f = fixture();
    f.settings.autoPortraitOnFill = true;
    f.setImageReply(async card => {
        if (card.name === 'Mira') throw new Error('Provider unavailable');
        return '/images/Elza.png';
    });
    assert.deepEqual(await f.run(['Mira', 'Elza']), { generated: 2, failed: 0 });
    assert.equal(f.cards.find(card => card.name === 'Mira').profile.appearance, 'Blue coat');
    assert.equal(f.cards.find(card => card.name === 'Elza').imageUrl, '/images/Elza.png');
    assert.equal(f.warnings.length, 1);
});

test('a stale portrait result is not assigned and manual portrait selection takes precedence', async () => {
    const f = fixture();
    f.settings.autoPortraitOnFill = true;
    f.setImageReply(async () => { f.invalidate(); return '/images/stale.png'; });
    await f.run(['Mira', 'Elza']);
    assert.equal(f.cards.find(card => card.name === 'Mira').imageUrl, undefined);
    assert.equal(f.cards.some(card => card.name === 'Elza'), false);
    const manual = fixture();
    manual.settings.autoPortraitOnFill = true;
    manual.setImageReply(async card => { card.imageUrl = '/manual.png'; return '/generated.png'; });
    await manual.run(['Mira']);
    assert.equal(manual.cards.find(card => card.name === 'Mira').imageUrl, '/manual.png');
    assert.deepEqual(manual.cards.find(card => card.name === 'Mira').images, ['/generated.png']);
});
