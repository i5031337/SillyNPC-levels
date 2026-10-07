import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

function load(file, bindings, result) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replaceAll('export function ', 'function ');
    return new Function(...Object.keys(bindings), `${source}\nreturn ${result};`)(...Object.values(bindings));
}

function fixture() {
    const state = { player: { name: 'Rhea' }, castDecisions: {} };
    const cards = [];
    let portrait = 'player-portrait.png';
    const deps = {
        loadStateFromMetadata: () => state,
        resolvePersonaAvatarAndName: () => ({ name: 'Rhea', avatar: 'Rhea.png' }),
        getPlayerImageUrl: () => portrait,
    };
    load('tracker/status-cast-decisions.js', {
        getAllCharacters: () => cards,
        getUserAvatar: avatar => `/User Avatars/${avatar}`,
        getIgnoredSpeakerLabels: () => new Set(),
        normaliseSpeakerLabel: name => name.trim().toLowerCase(),
    }, 'bind')(deps);
    return { state, cards, deps, clearPortrait: () => { portrait = ''; } };
}

test('player labels automatically resolve to the player portrait and stay out of the NPC cast', () => {
    const { deps, state, cards, clearPortrait } = fixture();
    for (const name of ['Rhea', ' rHeA ']) {
        assert.deepEqual(deps.resolvePersonaSpeaker(name), { name: 'Rhea', imageUrl: 'player-portrait.png' });
        assert.equal(deps.mayJoinScene(name), false);
    }
    cards.push({ id: 'npc', name: 'Rhea' });
    assert.equal(deps.resolvePersonaSpeaker('Rhea').imageUrl, 'player-portrait.png');
    clearPortrait();
    assert.equal(deps.resolvePersonaSpeaker('Rhea').imageUrl, '/User Avatars/Rhea.png');
    state.player.name = 'Story Rhea';
    assert.equal(deps.resolvePersonaSpeaker('Story Rhea').name, 'Rhea');
    assert.equal(deps.resolvePersonaSpeaker('Other'), null);
    assert.equal(deps.resolvePersonaSpeaker(''), null);
});

test('chat decisions and NPC aliases still resolve correctly', () => {
    const { deps, state, cards } = fixture();
    cards.push({ id: 'alias', name: 'Captain', aliases: [{ pattern: 'Rhea' }] });
    assert.equal(deps.resolvePersonaSpeaker('Rhea').imageUrl, 'player-portrait.png');
    assert.equal(deps.mayJoinScene('Rhea'), false);
    state.castDecisions.captain = 'persona';
    assert.equal(deps.resolvePersonaSpeaker('Captain').name, 'Rhea');
    state.castDecisions.captain = 'excluded';
    assert.equal(deps.resolvePersonaSpeaker('Captain'), null);
    assert.equal(deps.resolvePersonaSpeaker('Rhea'), null);
    state.castDecisions = {};
    assert.equal(deps.resolvePersonaSpeaker('Captain'), null);
});

test('player avatar keeps the written label ahead of a matched NPC alias', () => {
    const { deps } = fixture();
    const createAvatarImg = load('chat/chat-portraits.js', {
        document: { createElement: () => ({ dataset: {}, style: {}, setAttribute() {} }) },
        getSettings: () => ({}),
        resolvePersonaSpeaker: deps.resolvePersonaSpeaker,
        BUILT_IN_DEFAULT_AVATAR: 'default.png',
    }, 'createAvatarImg');
    const avatar = createAvatarImg({ name: 'Rhea', char: { id: 'npc', name: 'Captain' }, defaultImage: 'npc.png' });
    assert.equal(avatar.src, 'player-portrait.png');
    assert.equal(avatar.dataset.persona, 'true');
    assert.equal(avatar.dataset.charId, undefined);
    assert.equal(avatar.dataset.default, undefined);
});
