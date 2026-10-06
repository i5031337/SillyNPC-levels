import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { promptText } from '../src/prompts/prompt-texts.js';

const persona = { name: 'Player', avatar: 'player.png', description: 'An elven healer with silver hair.' };
const player = { name: 'Player', isPlayer: true, personaKey: persona.avatar, profile: {} };
const fields = [{ id: 'appearance', label: 'Appearance' }];
const load = path => readFileSync(new URL(path, import.meta.url), 'utf8');

function profileFixture(activePersona = persona) {
    const source = load('../src/characters/character-fill.js')
        .replace(/^import .*;\n/gm, '').replace(/^export \{.*;\n/gm, '').replaceAll('export ', '');
    const requests = [];
    const dependencies = {
        promptText, getContext: () => ({ chat: [] }), fillTemplate: text => text,
        getSettings: () => ({ statusTracker: {} }), saveSettings() {}, hintFor: () => 'Describe appearance.',
        fieldsForCard: () => fields, requestExtraction: async prompt => {
            requests.push(prompt);
            return { appearance: 'Silver hair' };
        }, coerceToUpdate: value => value, describeTrackedFacts: () => '', describeProfile: () => '',
        buildLoreExcerpt: () => ({ text: '' }), tryAutoSyncLorebook: async () => false,
        charactersMentionedIn: () => [], getPersonaData: () => activePersona,
        readLoreEntry: async () => '', syncProfileToLore: async () => {},
    };
    const api = new Function(...Object.keys(dependencies),
        `${source}\nreturn { fillProfile, fillSources };`)(...Object.values(dependencies));
    return { ...api, requests };
}

test('a persona description alone supports player field generation and reaches the request', async () => {
    const f = profileFixture();
    const card = structuredClone(player);
    const result = await f.fillProfile(card);
    assert.deepEqual(result, { ok: true, filled: ['Appearance'] });
    assert.match(f.requests[0], /SillyTavern persona description for Player:/);
    assert.ok(f.requests[0].includes(persona.description));
    assert.equal(card.profile.appearance, 'Silver hair');
});

test('persona descriptions do not support NPCs, other personas, or blank descriptions', async () => {
    for (const [card, active] of [
        [{ name: 'Player', profile: {} }, persona],
        [{ ...player, personaKey: 'other.png' }, persona],
        [player, { ...persona, description: '  ' }],
    ]) {
        const f = profileFixture(active);
        assert.equal((await f.fillSources(card)).enough, false);
        await f.fillProfile(card);
        assert.deepEqual(f.requests, []);
    }
});

async function lorePrompt(card, activePersona = persona) {
    const source = load('../src/api/api-lore-generate.js')
        .split('export async function generateLoreContent')[1]
        .split('export async function saveLoreContent')[0];
    let sent;
    const dependencies = {
        buildLoreExcerpt: () => ({ text: '' }), chat: [], retrieveWorldFacts: async () => '',
        DEFAULT_LORE_PROMPT: 'Fill profile for {{name}}',
        mergeLoreValues: () => ({}), profileFieldsForCard: () => fields, hintFor: () => 'Describe appearance.',
        fillTemplate: (template, values) => template.replace('{{name}}', values.name),
        namesFor: card => [card.name], describeTrackedFacts: () => '', getPersonaData: () => activePersona,
        requestLore: async prompt => { sent = prompt; return { text: '', truncated: false }; },
        parseLoreReply: () => ({ tags: '', content: '', followedSections: false }),
        escapeRegExp: text => text, parseLoreContent: () => null,
    };
    const generate = new Function(...Object.keys(dependencies),
        `return async function generateLoreContent${source}`)(...Object.values(dependencies));
    await generate(card, null, null);
    return sent;
}

test('the combined profile and lore request includes the player persona description', async () => {
    assert.ok((await lorePrompt(player)).includes(persona.description));
    for (const card of [{ name: 'Player' }, { ...player, personaKey: 'other.png' }]) {
        assert.ok(!(await lorePrompt(card)).includes(persona.description));
    }
    assert.doesNotMatch(await lorePrompt(player, { ...persona, description: '' }), /persona description/);
});
