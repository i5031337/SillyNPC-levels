import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { collectionAppliesTo } from '../src/core/collection-targets.js';
import { progressionFields } from '../src/tracker/progression-fields.js';

function load(path, globals, names = 'bind') {
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '').replaceAll('export ', '');
    return new Function(...Object.keys(globals), `${source}\nreturn { ${names} };`)(...Object.values(globals));
}

function fixture() {
    const cards = [];
    let saves = 0;
    const settings = { statusTracker: { globalStats: [], playerStats: [], npcStats: [], collections: [
        { id: 'inventory', targets: ['player', 'npc'], fields: [{ name: 'title', isPrimary: true }] },
        { id: 'skills', targets: ['npc'], fields: [{ name: 'title', isPrimary: true }] },
    ] } };
    const globals = { getSettings: () => settings, getAllCharacters: () => cards,
        saveSettings: () => saves++, getContext: () => ({ chat: [] }),
        npcStatsFor: () => [], npcTemplateFor: () => null, proposedNpcTemplate: () => null,
        collectionAppliesTo, progressionFields, debugLog() {}, LOG_PREFIX: '[test]', eventSource: { emit() {} } };
    const { syncNpcCollectionsToCards } = load('tracker/npc-collections.js', globals, 'syncNpcCollectionsToCards');
    globals.syncNpcCollectionsToCards = syncNpcCollectionsToCards;
    const deps = { committedState: { global: {}, player: { name: 'Player', stats: {},
        collections: { inventory: [{ title: 'Player sword' }] } }, characters: [
        { name: 'Mira', stats: {}, collections: {} },
    ] }, hasOpenChat: () => true, getCurrentPersonaName: () => 'Player',
    loadStateFromMetadata() { return this.committedState; },
    saveStateToMetadata(state) { this.committedState = state; },
    resolveCanonicalName: name => name, mayJoinScene: () => true,
    mergeDuplicateCharacters: () => false, groupIncomingStats: () => new Map(),
    getMergedItem: (_id, item) => item, constrainToDefinition: (_field, value) => value };
    for (const module of ['status-collection-updates', 'status-scene-presence', 'status-apply-update']) {
        load(`tracker/${module}.js`, globals).bind(deps);
    }
    const ui = load('ui/collections/ui-collection.js', { ...globals,
        saveStateToMetadata: state => deps.saveStateToMetadata(state) }, 'persistCollectionEdit');
    return { cards, deps, ui, saves: () => saves };
}

for (const exit of ['reader cast', 'grace period', 'manual removal']) {
    test(`reader collections survive ${exit} when the card is created after the reading`, () => {
        const { cards, deps } = fixture();
        deps.applyUpdate({ characters: [{ name: 'Mira', collections: {
            inventory: { add: [{ title: 'NPC ring' }] }, skills: { add: [{ title: 'Heal' }] },
        } }] });
        const expected = structuredClone(deps.committedState.characters[0].collections);
        const card = { name: 'Mira', statusCollections: {} };
        cards.push(card);
        if (exit === 'reader cast') deps.reconcileScenePresence([], 1, { authoritative: true });
        else if (exit === 'manual removal') deps.removeActiveCharacter('Mira');
        else for (let tick = 1; tick <= 4; tick++) deps.reconcileScenePresence([], tick);
        assert.equal(deps.committedState.characters.length, 0);
        assert.deepEqual(card.statusCollections, expected);
        // Read the saved card after leaving, then return through normal scene reconciliation.
        card.statusCollections = structuredClone(card.statusCollections);
        deps.reconcileScenePresence(['Mira'], 5, { authoritative: true });
        assert.deepEqual(deps.committedState.characters[0].collections, expected);
        assert.deepEqual(deps.committedState.player.collections.inventory, [{ title: 'Player sword' }]);
        assert.notEqual(deps.committedState.characters[0].collections.inventory, card.statusCollections.inventory);
    });
}

test('reader saves shared collections to existing cards and previews leave them alone', () => {
    const { cards, deps } = fixture();
    const card = { name: 'Mira', statusCollections: {} };
    cards.push(card);
    const update = { characters: [{ name: 'Mira', collections: { inventory: { add: [{ title: 'NPC ring' }] } } }] };
    deps.applyUpdate(update, { dryRun: true });
    assert.deepEqual(card.statusCollections, {});
    deps.applyUpdate(update);
    assert.deepEqual(card.statusCollections.inventory, [{ title: 'NPC ring' }]);
});

test('manual edits update the card immediately, including an empty collection', () => {
    const { cards, deps, ui } = fixture();
    const card = { name: 'Mira', statusCollections: {} };
    cards.push(card);
    const target = deps.committedState.characters[0];
    target.collections.inventory = [{ title: 'NPC ring' }];
    const where = { target, state: deps.committedState, offstage: false };
    ui.persistCollectionEdit('Item added', where, false);
    assert.deepEqual(card.statusCollections.inventory, [{ title: 'NPC ring' }]);
    target.collections.inventory = [];
    ui.persistCollectionEdit('Item removed', where, false);
    assert.deepEqual(card.statusCollections.inventory, []);
});
