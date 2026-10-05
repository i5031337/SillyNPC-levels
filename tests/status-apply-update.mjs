import { progressionFields } from '../src/tracker/progression-fields.js';
import { npcStatsFor, npcTemplateFor, proposedNpcTemplate } from '../src/core/npc-templates.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { canTrackerSetNpcStat } from '../src/tracker/stat-persistence.js';
import { progressXp } from '../src/tracker/progression.js';
import { expandNumericDeltas } from '../src/tracker/extractor/status-extractor-deltas.js';

test('reader deltas become absolute values without changing ceilings or innate stats', () => {
    const settings = {
        globalStats: [{ name: 'Heat' }],
        playerStats: [{ name: 'HP' }, { name: 'XP', type: 'number', defaultValue: '0/100' }, { name: 'Level', type: 'number', defaultValue: '1' }],
        npcStats: [{ name: 'Energy' }, { name: 'Power', persistence: 'innate' }],
    };
    const state = {
        global: { Heat: '2' },
        player: { stats: { HP: '8/10', XP: '90/100', Level: '1' } },
        characters: [{ name: 'Mira', stats: { Energy: '5/5', Power: '4' } }],
    };
    const reply = {
        global: {}, globalDeltas: { Heat: 1 },
        player: { stats: { HP: '6/10' }, deltas: { HP: -3, XP: 20, Level: 1 } },
        characters: [{ name: 'Mira', deltas: { Energy: -2, Power: 3 } }],
    };
    expandNumericDeltas(reply, state, settings);
    assert.deepEqual(reply.global, { Heat: '3' });
    assert.equal(reply.player.stats.HP, '6/10');
    assert.equal(reply.player.stats.XP, '110/100');
    assert.equal(reply.characters[0].Energy, '3/5');
    assert.equal(reply.characters[0].Power, undefined);
    assert.equal(reply.player.deltas, undefined);
});

test('reader XP uses only a positive delta when raw XP is also present', () => {
    const settings = { globalStats: [], npcStats: [], playerStats: [{ name: 'XP', type: 'number', defaultValue: '0/100' }, { name: 'Level', type: 'number', defaultValue: '1' }] };
    const state = { global: {}, characters: [], player: { stats: { XP: '90/100', Level: '1' } } };
    const reply = { player: { stats: { XP: '2' }, deltas: { XP: 2 } }, characters: [] };
    expandNumericDeltas(reply, state, settings);
    assert.equal(reply.player.stats.XP, '92/100');
    assert.equal(progressXp(state.player.stats.XP, reply.player.stats.XP, state.player.stats.Level).xp, '92/100');

    const rollover = { player: { stats: { XP: '2' }, deltas: { XP: 20 } }, characters: [] };
    expandNumericDeltas(rollover, state, settings);
    assert.deepEqual(progressXp(state.player.stats.XP, rollover.player.stats.XP, state.player.stats.Level), {
        xp: '10/100', level: '2', levelsGained: 1,
    });
});

test('reader ignores raw-only XP and nonpositive XP deltas', () => {
    const settings = { globalStats: [], npcStats: [], playerStats: [{ name: 'XP', type: 'number', defaultValue: '0/100' }, { name: 'Level', type: 'number', defaultValue: '1' }] };
    const state = { global: {}, characters: [], player: { stats: { XP: '90/100', Level: '1' } } };
    for (const player of [{ stats: { XP: '2' } }, { XP: '2', XP_current: '2' },
        { stats: { XP: '2' }, deltas: { XP: -2 } },
        { stats: { XP: '2' }, deltas: { XP: 0 } }]) {
        const reply = { player, characters: [] };
        expandNumericDeltas(reply, state, settings);
        assert.equal(reply.player.stats?.XP, undefined);
        assert.equal(reply.player.XP, undefined);
    }
    const blank = { player: { stats: { XP: '2' }, deltas: { XP: 2 } }, characters: [] };
    expandNumericDeltas(blank, { ...state, player: { stats: { XP: '', Level: '1' } } }, settings);
    assert.equal(blank.player.stats.XP, undefined);
});

// This module's SillyTavern imports require a browser. Inject those boundaries
// while exercising its real bind(deps) implementation in Node.
const source = readFileSync(new URL('../src/tracker/status-apply-update.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replace('export function bind', 'function bind');
const loadBind = new Function('npcStatsFor', 'npcTemplateFor', 'proposedNpcTemplate', 'eventSource', 'getSettings', 'saveSettings',
    'canTrackerSetNpcStat', 'getAllCharacters', 'LOG_PREFIX', 'debugLog', 'progressXp', 'progressionFields',
    `${source}\nreturn bind;`);

function fixture({ openChat = true } = {}) {
    const card = { name: 'Mira', aliases: [], statusOverrides: {}, statusCollections: {} };
    const settings = {
        statusTracker: {
            globalStats: [{ name: 'Scene' }],
            playerStats: [{ name: 'HP' }],
            npcStats: [{ name: 'HP', persistence: 'variable' }],
            collections: [{ id: 'items' }],
        },
    };
    const initial = {
        global: { Scene: 'old' },
        player: { stats: { HP: '5' }, collections: { items: ['sword'] } },
        characters: [
            { name: 'Mira', stats: { HP: '4' }, collections: { items: ['ring'] } },
            { name: 'Jon', stats: { HP: '3' }, collections: {} },
        ],
        recently_deleted: { items: { lost: 1, retained: 2 } },
    };
    const calls = { saved: [], emitted: [], settings: 0, collections: [] };
    const bind = loadBind(
        npcStatsFor, npcTemplateFor, proposedNpcTemplate,
        { emit: (...args) => calls.emitted.push(args) },
        () => settings,
        () => { calls.settings++; },
        canTrackerSetNpcStat,
        () => [card],
        '[test]',
        () => {},
        progressXp, progressionFields,
    );
    const deps = {
        committedState: initial,
        hasOpenChat: () => openChat,
        loadStateFromMetadata: () => initial,
        mergeStatValue: (_old, value) => value,
        constrainToDefinition: (_def, value) => value,
        findMatchingStatKey: (stats, name) =>
            Object.keys(stats).find(key => key.toLowerCase() === name.toLowerCase()),
        groupIncomingStats: (stats, resolve, valid, skip) => {
            const groups = new Map();
            for (const [name, value] of Object.entries(stats)) {
                if (skip(name)) continue;
                const key = resolve(name);
                if (key && valid(key)) groups.set(key, { whole: value });
            }
            return groups;
        },
        combineStatValue: (_old, group) => group.whole,
        applyCollectionUpdate: (owner, id, value, options) => {
            calls.collections.push({ name: owner.name, id, options });
            owner.collections[id] = value;
        },
        resolveCanonicalName: name => name,
        mayJoinScene: () => true,
        buildCharacterState: name => ({ name, stats: { HP: '' }, collections: {} }),
        updateCardOffstage: () => null,
        saveStateToMetadata: (...args) => calls.saved.push(args),
    };
    bind(deps);
    return { deps, card, calls, initial, settings };
}

test('committed update changes state and card, then saves once', () => {
    const { deps, card, calls, initial } = fixture();
    const state = deps.applyUpdate({
        global: { scene: 'new' },
        player: { stats: { hp: '7' }, items: ['book'] },
        characters: [{ name: 'Mira', stats: { hp: '8' }, items: ['key'] }],
    });
    assert.equal(state.global.Scene, 'new');
    assert.equal(state.player.stats.HP, '7');
    assert.deepEqual(state.player.collections.items, ['book']);
    assert.deepEqual(state.characters.map(char => char.name), ['Mira', 'Jon']);
    assert.equal(state.characters[0].stats.HP, '8');
    assert.deepEqual(state.characters[0].collections.items, ['key']);
    assert.equal(card.statusOverrides.HP, '8');
    assert.deepEqual(card.statusCollections.items, ['key']);
    assert.deepEqual(state.recently_deleted, { items: { retained: 1 } });
    assert.equal(initial.global.Scene, 'old');
    assert.equal(calls.settings, 1);
    assert.equal(calls.saved.length, 1);
    assert.equal(calls.emitted.length, 1);
});

test('dry run previews character changes without mutating card or committing', () => {
    const { deps, card, calls } = fixture({ openChat: false });
    const state = deps.applyUpdate({
        characters: [{ name: 'Mira', stats: { HP: '9' }, collections: { items: ['map'] } }],
    }, { dryRun: true });
    assert.equal(state.characters[0].stats.HP, '9');
    assert.deepEqual(state.characters[0].collections.items, ['map']);
    assert.deepEqual(card.statusOverrides, {});
    assert.deepEqual(card.statusCollections, {});
    assert.equal(calls.settings, 0);
    assert.equal(calls.saved.length, 0);
    assert.equal(calls.emitted.length, 0);
});

test('player named in NPC updates never creates or changes a cast row', () => {
    const { deps, calls } = fixture();
    deps.committedState.player.name = 'Alex';
    const update = { characters: [
        { name: 'Alex', stats: { HP: '9' } },
        { name: 'alex', stats: { HP: '8' } },
    ] };
    const fresh = deps.applyUpdate(update, { dryRun: true });
    assert.deepEqual(fresh.characters.map(char => char.name), ['Mira', 'Jon']);

    deps.committedState.characters.push({ name: 'Alex', stats: { HP: '3' }, collections: {} });
    const state = deps.applyUpdate(update);
    assert.equal(state.characters.find(char => char.name === 'Alex').stats.HP, '3');
    assert.equal(state.characters.length, 3);
    assert.equal(calls.settings, 0);
});

test('missing chat rejects before card writes', () => {
    const { deps, card, calls } = fixture({ openChat: false });
    const priorWarn = console.warn;
    console.warn = () => {};
    try {
        assert.equal(deps.applyUpdate({ characters: [{ name: 'Mira', stats: { HP: '9' } }] }), null);
    } finally {
        console.warn = priorWarn;
    }
    assert.deepEqual(card.statusOverrides, {});
    assert.equal(calls.settings, 0);
    assert.equal(calls.saved.length, 0);
});

test('reader-reported NPC survives speaker redraw without speaking', () => {
    const source = readFileSync(new URL('../src/tracker/status-scene-presence.js', import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replace('export function bind', 'function bind');
    const bindPresence = new Function('npcStatsFor', 'npcTemplateFor', 'proposedNpcTemplate', 'eventSource', 'getSettings', 'getAllCharacters', 'debugLog',
        `${source}\nreturn bind;`);
    const settings = { statusTracker: {
        npcStats: [{ name: 'HP', defaultValue: '' }],
    } };
    const saved = [];
    const deps = {
        committedState: { global: {}, characters: [], presence: { tick: 0, messageId: null, seen: [] } },
        resolveCanonicalName: name => name,
        mayJoinScene: (name, { speaker = true } = {}) => name !== 'Rejected'
            && (!speaker || name !== 'Mira'),
        mergeDuplicateCharacters: () => false,
        getInitialStatValue: value => value,
        resolveMaxValue: () => '',
        saveStateToMetadata(state) { saved.push(structuredClone(state)); this.committedState = state; },
    };
    bindPresence(npcStatsFor, npcTemplateFor, proposedNpcTemplate, { emit() {} }, () => settings, () => [], () => {})(deps);

    deps.reconcileScenePresence(['Other'], '4');
    deps.reconcileScenePresence(['Mira', 'Rejected'], '4', { authoritative: true });
    assert.deepEqual(saved.at(-1).characters.map(char => char.name), ['Mira']);
    deps.reconcileScenePresence(['Other'], '4');
    assert.deepEqual(deps.committedState.characters.map(char => char.name), ['Mira']);
    assert.deepEqual(deps.committedState.presence.seen, ['Mira']);

    deps.registerActiveCharacter('Other');
    deps.reconcileScenePresence([], '4');
    assert.deepEqual(deps.committedState.characters.map(char => char.name), ['Mira', 'Other']);
    assert.deepEqual(deps.committedState.presence.seen, ['Mira', 'Other']);

    deps.removeActiveCharacter('Other');
    deps.resolveCanonicalName = name => name === 'Alias' ? 'Other' : name;
    deps.committedState.presence.seen.push('Alias');
    deps.reconcileScenePresence(['Other'], '4');
    assert.deepEqual(deps.committedState.characters.map(char => char.name), ['Mira']);
    assert.deepEqual(deps.committedState.presence.suppressed, ['Other']);

    // A fresh state object and another complete reader list model reload and regeneration.
    deps.committedState = structuredClone(deps.committedState);
    deps.reconcileScenePresence(['Mira', 'Other'], '4', { authoritative: true });
    assert.deepEqual(deps.committedState.characters.map(char => char.name), ['Mira']);

    deps.registerActiveCharacter('Other');
    assert.deepEqual(deps.committedState.presence.suppressed, []);
    deps.removeActiveCharacter('Other');
    deps.reconcileScenePresence(['Other'], '5');
    assert.ok(deps.committedState.characters.some(char => char.name === 'Other'));
});


test('configured player and enabled NPC fields roll over identically without mutating dry-run cards', () => {
    const { deps, card, initial, settings } = fixture();
    const fields = [{ id: 'earned', name: 'Experience', type: 'number', defaultValue: '0/100' }, { id: 'rank', name: 'Rank', type: 'number', defaultValue: '1', updatePolicy: 'advancement' }];
    settings.statusTracker.playerStats = fields;
    settings.statusTracker.npcStats = fields;
    settings.statusTracker.progression = { player: { enabled: true, xpFieldId: 'earned', levelFieldId: 'rank' } };
    settings.statusTracker.npcTemplates = [{ id: 'fighter', statIds: ['earned', 'rank'],
        progression: { enabled: true, xpFieldId: 'earned', levelFieldId: 'rank' } }];
    initial.player.stats = { Experience: '90/100', Rank: '2' };
    initial.characters[0].npcTemplateId = 'fighter';
    initial.characters[0].stats = { Experience: '95/100', Rank: '3' };
    const update = { player: { stats: { Experience: '310/100' } },
        characters: [{ name: 'Mira', stats: { Experience: '200/100' } }] };
    const preview = deps.applyUpdate(update, { dryRun: true });
    assert.deepEqual(preview.player.stats, { Experience: '10/100', Rank: '5' });
    assert.deepEqual(preview.characters[0].stats, { Experience: '0/100', Rank: '5' });
    assert.deepEqual(card.statusOverrides, {});
    const result = deps.applyUpdate(update);
    assert.deepEqual(result.characters[0].stats, preview.characters[0].stats);
    assert.equal(card.statusOverrides.Rank, '5');
    assert.equal(initial.characters[0].stats.Rank, '3');
    const manual = deps.applyUpdate(update, { dryRun: true, verbatim: true });
    assert.equal(manual.player.stats.Experience, '310/100');
    assert.equal(manual.player.stats.Rank, '2');
    const initialization = deps.applyUpdate(update, { dryRun: true, allowAdvancementChanges: true });
    assert.equal(initialization.characters[0].stats.Experience, '200/100');
    assert.equal(initialization.characters[0].stats.Rank, '3');
    settings.statusTracker.npcTemplates[0].progression.enabled = false;
    const disabled = deps.applyUpdate(update, { dryRun: true });
    assert.equal(disabled.characters[0].stats.Experience, '200/100');
    assert.equal(disabled.characters[0].stats.Rank, '3');
});

test('enabled NPC XP accepts positive deltas; disabled templates keep ordinary stat behavior', () => {
    const settings = { globalStats: [], playerStats: [], npcStats: [
        { id: 'earned', name: 'Experience', type: 'number', defaultValue: '0/100', updatePolicy: 'advancement' },
        { id: 'rank', name: 'Rank', type: 'number', defaultValue: '1', updatePolicy: 'advancement' },
    ], npcTemplates: [{ id: 'fighter', statIds: ['earned', 'rank'],
        progression: { enabled: true, xpFieldId: 'earned', levelFieldId: 'rank' } }] };
    const state = { characters: [{ name: 'Mira', npcTemplateId: 'fighter', stats: { Experience: '90/100', Rank: '1' } }] };
    const update = { characters: [{ name: 'Mira', stats: { Experience: '999/100' }, deltas: { Experience: 20, Rank: 10 } }] };
    expandNumericDeltas(update, state, settings);
    assert.deepEqual(update.characters[0].stats, { Experience: '110/100' });
    const negative = { characters: [{ name: 'Mira', deltas: { Experience: -1 } }] };
    expandNumericDeltas(negative, state, settings);
    assert.equal(negative.characters[0].Experience, undefined);
});


test('dry-run collection writes carry preview options for both player and NPC', () => {
    const { deps, calls } = fixture();
    deps.applyUpdate({ player: { collections: { items: { replace: [{ name: 'Key' }] } } },
        characters: [{ name: 'Mira', collections: { items: { replace: [{ name: 'Move' }] } } }] }, { dryRun: true });
    assert.equal(calls.collections.length, 2);
    assert.ok(calls.collections.every(call => call.options.dryRun === true));
    assert.equal(calls.settings, 0);
    assert.equal(calls.saved.length, 0);
});
