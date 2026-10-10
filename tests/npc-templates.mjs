import { progressionFields } from '../src/tracker/progression-fields.js';
import { progressXp } from '../src/tracker/progression.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeSystemDefinition, projectSystemTracker } from '../src/core/system-schema.js';
import { setProfileSettingsProvider, profileFieldsForCard } from '../src/core/profile-fields.js';
import { activeNpcSystem, npcStatsFor, npcTemplateFor, proposedNpcTemplate, describeNpcTemplates } from '../src/core/npc-templates.js';

function fixture() {
    const definition = normalizeSystemDefinition({ schemaVersion: 1, name: 'Adventure',
        profiles: { player: [{ id: 'occupation', label: 'Occupation' }], npc: [
            { id: 'occupation', label: 'Occupation' }, { id: 'species', label: 'Species' },
        ] },
        stats: { world: [], player: [], npc: [
            { id: 'hp', name: 'HP', type: 'number', defaultValue: '10', maxStatValue: '10' },
            { id: 'friendship', name: 'Friendship', type: 'number', defaultValue: '0' },
        ] },
        npcTemplates: [
            { id: 'human', name: 'Human', description: 'Human trainers and townspeople.', profileIds: ['occupation'], statIds: ['hp'] },
            { id: 'pokemon', name: 'Pokémon', description: 'Pokémon creatures.', profileIds: ['species'], statIds: ['hp', 'friendship'] },
        ],
    });
    const settings = { activeSystem: 'Adventure', statusTracker: {
        presets: { Adventure: { definition } }, npcStats: projectSystemTracker(definition).npcStats,
        globalStats: [], playerStats: [], collections: [],
    } };
    setProfileSettingsProvider(() => settings);
    return { definition, settings };
}
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replace('export function bind', 'function bind');

const assignMatchingTrackerTemplate = new Function('npcTemplateFor', 'getContext',
    `${source('../src/characters/characters.js').replaceAll('export ', '')}\nreturn assignMatchingTrackerTemplate;`)(npcTemplateFor, () => null);

test('a manually named card inherits the matching tracker template without changing an existing choice', () => {
    fixture();
    const state = { characters: [{ name: 'Mira', npcTemplateId: 'human', stats: { HP: '8/10' } }] };
    const card = { name: '', npcTemplateId: '' };
    assert.equal(assignMatchingTrackerTemplate(card, state), false);
    card.name = 'Someone else';
    assert.equal(assignMatchingTrackerTemplate(card, state), false);
    card.name = ' mIRA ';
    assert.equal(assignMatchingTrackerTemplate(card, state), true);
    assert.equal(card.npcTemplateId, 'human');
    assert.equal(assignMatchingTrackerTemplate(card, state), false);
    card.npcTemplateId = 'pokemon';
    assert.equal(assignMatchingTrackerTemplate(card, state), false);
    assert.equal(card.npcTemplateId, 'pokemon');
    assert.deepEqual(state.characters[0].stats, { HP: '8/10' });
    setProfileSettingsProvider(() => null);
});

test('manual template inheritance uses remembered assignments and rejects unknown templates', () => {
    fixture();
    for (const state of [
        { characters: [], npcTemplateAssignments: { mira: 'human' } },
        { characters: [{ id: 'tracker-mira', name: 'Mira' }], npcTemplateAssignments: { 'tracker-mira': 'human' } },
    ]) {
        const card = { name: 'Mira', npcTemplateId: '' };
        assert.equal(assignMatchingTrackerTemplate(card, state), true);
        assert.equal(card.npcTemplateId, 'human');
    }
    const card = { name: 'Mira', npcTemplateId: '' };
    assert.equal(assignMatchingTrackerTemplate(card, { characters: [{ name: 'Mira', npcTemplateId: 'unknown' }] }), false);
    assert.equal(assignMatchingTrackerTemplate(card, undefined), false);
    assert.equal(card.npcTemplateId, '');
    setProfileSettingsProvider(() => null);
});

const diffSource = [source('../src/tracker/status-diff-compare.js'), source('../src/tracker/status-diff-review.js')]
    .join('\n').replaceAll('export function ', 'function ').replace(/export \{ splitValue \};/g, '');
const { computeStateDiff, partitionChanges, buildUpdateFromChanges } = new Function(
    'splitValue', 'debugLog', 'activeNpcSystem', 'npcTemplateFor',
    `${diffSource}\nreturn { computeStateDiff, partitionChanges, buildUpdateFromChanges };`)(
    value => { const [current = '', max = ''] = String(value ?? '').split('/'); return { current, max }; },
    () => {}, activeNpcSystem, npcTemplateFor);

function applyFixture(settings) {
    const card = { id: 'mira', name: 'Mira', statusOverrides: {} };
    const initial = { global: {}, player: { stats: {} }, characters: [{ id: card.id, name: card.name, stats: {}, collections: {} }] };
    const saves = [];
    const deps = {
        committedState: initial, hasOpenChat: () => true,
        resolveCanonicalName: name => name, mayJoinScene: () => true,
        groupIncomingStats: (stats, match) => new Map(Object.entries(stats).flatMap(([key, value]) => {
            const name = match(key); return name ? [[name, { whole: value }]] : [];
        })),
        findMatchingStatKey: (stats, name) => Object.keys(stats).find(key => key.toLowerCase() === name.toLowerCase()),
        combineStatValue: (existing, group) => group.whole,
        constrainToDefinition: (def, value) => String(value),
        getInitialStatValue: (value, max) => max ? `${value}/${max}` : value,
        saveStateToMetadata: state => { saves.push(state); deps.committedState = state; },
    };
    new Function('npcStatsFor', 'proposedNpcTemplate', 'eventSource', 'getSettings',
        'saveSettings', 'getAllCharacters', 'debugLog', 'progressionFields', 'progressXp',
        `${source('../src/tracker/status-apply-update.js')}\nreturn bind;`)(
        npcStatsFor, proposedNpcTemplate, { emit() {} }, () => settings, () => {},
        () => [card], () => {}, progressionFields, progressXp)(deps);
    return { deps, card, initial, saves };
}

test('templates select reusable profile and stat definitions without a fallback', () => {
    const { definition, settings } = fixture();
    assert.deepEqual(normalizeSystemDefinition(definition), definition);
    assert.equal(definition.legacyNpcTemplateId, undefined);
    assert.deepEqual(profileFieldsForCard({ npcTemplateId: 'human' }).map(field => field.id), ['occupation']);
    assert.deepEqual(profileFieldsForCard({ npcTemplateId: 'pokemon' }).map(field => field.id), ['species']);
    assert.deepEqual(profileFieldsForCard({ isPlayer: true }).map(field => field.id), ['occupation']);
    assert.deepEqual(profileFieldsForCard({}), []);
    assert.deepEqual(npcStatsFor({}, settings.statusTracker), []);
    assert.equal(proposedNpcTemplate({}, { npcTemplateId: 'made-up' }), null);
    const empty = normalizeSystemDefinition({ ...definition, npcTemplates: [] });
    assert.deepEqual(empty.npcTemplates, []);
    assert.equal(empty.legacyNpcTemplateId, undefined);
    assert.deepEqual(npcStatsFor({ npcTemplateId: 'human' }, settings.statusTracker, empty), []);
    setProfileSettingsProvider(() => null);
});

test('saved legacy sheets keep their schema, but a fresh NPC is unassigned', () => {
    const legacy = normalizeSystemDefinition({});
    assert.equal(npcTemplateFor({ stats: { HP: '3' } }, legacy).id, 'npc');
    assert.equal(npcTemplateFor({ name: 'New', stats: {} }, legacy), null);
    assert.equal(npcTemplateFor({ npcTemplateId: '', stats: { HP: '3' } }, legacy), null);
    assert.equal(npcTemplateFor({ npcTemplateId: '', profile: { role: 'Trainer' } }, legacy), null);
    assert.deepEqual(normalizeSystemDefinition(legacy), legacy);
});

test('automatic assignment is validated, dry runs do not write cards, and other-template stats are refused', () => {
    const { settings } = fixture();
    const { deps, card, initial, saves } = applyFixture(settings);
    const proposal = { characters: [{ name: 'Mira', npcTemplateId: 'human', stats: { HP: '8/10', Friendship: '99' } }] };
    const preview = deps.applyUpdate(proposal, { dryRun: true });
    assert.equal(card.npcTemplateId, undefined);
    assert.equal(initial.characters[0].npcTemplateId, undefined);
    assert.equal(saves.length, 0);
    assert.deepEqual(preview.characters[0].stats, { HP: '8/10' });
    assert.equal(preview.npcTemplateAssignments.mira, 'human');
    deps.applyUpdate(proposal);
    assert.equal(card.npcTemplateId, 'human');
    assert.equal(card.statusOverrides.Friendship, undefined);
    const changed = deps.applyUpdate({ characters: [{ name: 'Mira', npcTemplateId: 'pokemon', stats: { Friendship: '50' } }] });
    assert.equal(changed.characters[0].npcTemplateId, 'human');
    assert.equal(changed.characters[0].stats.Friendship, undefined);
    setProfileSettingsProvider(() => null);
});

test('a sole template is assigned without asking the reader to select it', () => {
    const { definition, settings } = fixture();
    definition.npcTemplates = [definition.npcTemplates[0]];
    assert.equal(proposedNpcTemplate({}, {}).id, 'human');
    assert.equal(proposedNpcTemplate({}, { npcTemplateId: 'unknown' }), null);
    assert.doesNotMatch(describeNpcTemplates(), /npcTemplateId|template|assignment/i);
    assert.match(describeNpcTemplates(), /Human trainers/);
    const { deps, card } = applyFixture(settings);
    const preview = deps.applyUpdate({ characters: [{ name: 'Mira', stats: { HP: '8/10' } }] }, { dryRun: true });
    assert.equal(preview.characters[0].npcTemplateId, 'human');
    assert.deepEqual(preview.characters[0].stats, { HP: '8/10' });
    assert.equal(card.npcTemplateId, undefined);
    deps.applyUpdate({ characters: [{ name: 'Mira', stats: { HP: '8/10' } }] });
    assert.equal(card.npcTemplateId, 'human');
    setProfileSettingsProvider(() => null);
});

test('a new uncertain assignment is reviewable, but an existing unassigned NPC is not a change', () => {
    const { settings } = fixture();
    const { deps, initial } = applyFixture(settings);
    const proposed = deps.applyUpdate({ characters: [{ name: 'Mira', npcTemplateId: 'unknown', stats: { HP: '8' } }] }, { dryRun: true });
    assert.deepEqual(computeStateDiff(initial, proposed, settings.statusTracker), []);
    const changes = computeStateDiff({ ...initial, characters: [] }, proposed, settings.statusTracker);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].kind, 'npc-template');
    const { pending, auto } = partitionChanges(changes, { reviewMode: 'off' });
    assert.equal(pending.length, 1); assert.equal(auto.length, 0);
    const update = buildUpdateFromChanges([{ ...pending[0], after: 'pokemon' }], initial, settings.statusTracker);
    const state = deps.applyUpdate(update);
    assert.equal(state.characters[0].npcTemplateId, 'pokemon');
    assert.deepEqual(state.characters[0].stats, { HP: '10/10', Friendship: '0' });
    setProfileSettingsProvider(() => null);
});

test('an NPC without a card keeps its template when it returns to the scene', () => {
    const { settings } = fixture();
    const deps = {
        getInitialStatValue: (value, max) => max ? `${value}/${max}` : value,
        resolveMaxValue: stat => stat.maxStatValue,
    };
    new Function('npcStatsFor', 'npcTemplateFor', 'proposedNpcTemplate', 'getAllCharacters',
        `${source('../src/tracker/status-scene-presence.js')}\nreturn bind;`)(
        npcStatsFor, npcTemplateFor, proposedNpcTemplate, () => [])(deps);
    const actor = deps.buildCharacterState('Pikachu', { npcTemplateAssignments: { pikachu: 'pokemon' } }, settings.statusTracker);
    assert.equal(actor.npcTemplateId, 'pokemon');
    assert.deepEqual(Object.keys(actor.stats), ['HP', 'Friendship']);
    setProfileSettingsProvider(() => null);
});

test('renaming a shared stat preserves template membership and reader guidance stays compact', () => {
    const { settings } = fixture();
    settings.statusTracker.npcStats[0].name = 'Health';
    assert.deepEqual(npcStatsFor({ npcTemplateId: 'human' }, settings.statusTracker).map(stat => stat.name), ['Health']);
    const note = describeNpcTemplates();
    assert.match(note, /npcTemplateId/);
    assert.match(note, /omit it if uncertain/);
    assert.match(note, /pokemon.*Friendship/);
    assert.equal(note.split('\n').length, 3);
    setProfileSettingsProvider(() => null);
});

test('template lore contains only selected fields and remains readable after a template change', async () => {
    fixture();
    const { formatLoreContent, parseLoreContent } = await import('../src/lore/lore-format.js');
    const human = { npcTemplateId: 'human', profile: { occupation: 'Trainer' } };
    const text = formatLoreContent(human.profile, '', undefined, 'npc', profileFieldsForCard(human));
    assert.equal(text, 'Occupation: Trainer');
    assert.deepEqual(parseLoreContent(text), { occupation: 'Trainer' });
    const pokemon = { npcTemplateId: 'pokemon', profile: { species: 'Pikachu' } };
    const changed = formatLoreContent(pokemon.profile, text, undefined, 'npc', profileFieldsForCard(pokemon));
    assert.equal(changed, 'Species: Pikachu\nOccupation: Trainer');
    assert.equal(parseLoreContent(changed).species, 'Pikachu');
    setProfileSettingsProvider(() => null);
});

test('rebuilding a reading combines a template assignment with Saori’s stats and inventory', () => {
    const state = { global: {}, player: { stats: {} }, characters: [
        { name: 'Saori', stats: {}, collections: {} },
    ] };
    const stats = { Condition: 'Healthy', Standing: 0, Fertility: 3, Libido: 2, Inhibition: 3 };
    const clothes = [
        { description: 'Navy blue BRED University polo shirt' },
        { description: 'Short, pleated white tennis skirt' },
    ];
    const template = { scope: 'character', actor: 'Saori', kind: 'npc-template', after: 'npc' };
    const statRows = Object.entries(stats).map(([label, after]) => ({
        scope: 'character', actor: 'Saori', kind: 'stat', label, after,
    }));
    const itemRows = clothes.map(item => ({ scope: 'character', actor: 'Saori', kind: 'item-add',
        collectionId: 'inventory', item }));
    const tracker = { collections: [{ id: 'inventory', fields: [{ name: 'description', isPrimary: true }] }] };
    for (const rows of [[template, ...statRows, ...itemRows], [...statRows, template, ...itemRows]]) {
        const update = buildUpdateFromChanges(rows, state, tracker);
        assert.deepEqual(update.characters, [{ name: 'Saori', npcTemplateId: 'npc',
            stats: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, String(value)])),
            collections: { inventory: { replace: clothes } },
        }]);
    }
    assert.deepEqual(state.characters[0], { name: 'Saori', stats: {}, collections: {} });
});
