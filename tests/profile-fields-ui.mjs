import { systemStatFields } from '../src/core/system-fields.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { profileFieldValue } from '../src/core/profile-fields.js';
import { normalizeSystemDefinition, projectSystemTracker } from '../src/core/system-schema.js';
import { addProfileField, renameProfileField, moveProfileField, retireProfileField } from '../src/ui/system/ui-system-profile-operations.js';

class Element {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.listeners = {};
        this.value = '';
        this.style = {};
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    setAttribute() {}
}

const document = { createElement: tag => new Element(tag) };
const source = readFileSync(new URL('../src/ui/characters/ui-profile.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export async function ', 'async function ')
    .replaceAll('export function ', 'function ');
const fields = [
    { id: 'mood', label: 'Mood', multiline: false },
    { id: 'origin', label: 'Origin', multiline: true },
];
const { renderProfileFields, buildProfileBlocks } = new Function(
    'document', 'profileFieldsForCard', 'profileFieldValue', 'saveSettings', 'syncProfileToLore',
    `${source}\nreturn { renderProfileFields, buildProfileBlocks };`,
)(document, () => fields, profileFieldValue, () => {}, async () => {});

test('editor follows System fields and keeps retired values editable', () => {
    const char = { profile: { mood: 'Calm', origin: 'North', old_title: 'Captain' } };
    const root = new Element('div');
    renderProfileFields(char, root);
    const grid = root.children[0];
    assert.equal(grid.children.length, 2);
    for (const row of grid.children) {
        const controls = row.children[0].children[1];
        assert.equal(controls.children.length, 2);
        assert.ok(controls.children.every(control => control.tag === 'button'));
        assert.equal(row.children[1].tag, 'textarea');
    }
    const badgeInput = grid.children[0].children[1];
    badgeInput.value = 'Calm\nCurious';
    badgeInput.listeners.input();
    assert.equal(char.profile.mood, 'Calm\nCurious');
    assert.equal(fields[0].multiline, false);
    assert.equal(root.children[1].textContent, 'Other / Legacy details');
    const retiredInput = root.children[2].children[1];
    retiredInput.value = 'Admiral';
    retiredInput.listeners.input();
    assert.equal(char.profile.old_title, 'Admiral');
});

test('profile view includes saved fields outside the active System', () => {
    const blocks = buildProfileBlocks({ profile: { mood: 'Calm', old_title: 'Captain' } });
    assert.equal(blocks.length, 2);
    assert.equal(blocks[1].children[0].textContent, 'Other / Legacy details');
    assert.equal(blocks[1].children[1].children[0].textContent, 'old_title');
    assert.equal(blocks[1].children[1].children[1].textContent, 'Captain');
});

test('profile edits retain immutable IDs and retired definitions', () => {
    const fields = normalizeSystemDefinition({}).profiles;
    const first = addProfileField(fields, 'Secret Ties');
    const second = addProfileField(fields, 'Secret Ties');
    assert.equal(first.id, 'secret-ties');
    assert.deepEqual(first.targets, ['player', 'npc']);
    assert.equal(second.id, 'secret-ties-2');
    assert.equal(renameProfileField(first, 'Alliances'), true);
    assert.equal(first.id, 'secret-ties');
    const before = fields.findIndex(field => field.id === first.id);
    assert.equal(moveProfileField(fields, first.id, -1), true);
    assert.equal(fields.findIndex(field => field.id === first.id), before - 1);
    retireProfileField(first);
    const normalized = normalizeSystemDefinition({ schemaVersion: 2, profiles: fields });
    assert.deepEqual(normalized.profiles.find(field => field.id === first.id), first);
    assert.equal(normalized.profiles.find(field => field.id === first.id).retired, true);
    retireProfileField(first, false);
    assert.equal(first.retired, false);
});

const contextSource = readFileSync(new URL('../src/ui/system/ui-system-context.js', import.meta.url), 'utf8');
const saveSystemEditor = new Function('projectSystemTracker', 'systemStatFields',
    contextSource.slice(contextSource.indexOf('export function saveSystemEditor')).replace('export function ', 'function ')
    + '\nreturn saveSystemEditor;',
)(projectSystemTracker, systemStatFields);

test('shared editor saves refresh actor projections and preserve independently edited collections', () => {
    const definition = normalizeSystemDefinition({schemaVersion: 2, stats: {world: [], character: [
        {id: 'health', name: 'Health', type: 'number', defaultValue: '10/10', isPrimary: true, targets: ['player', 'npc']},
    ]}, profiles: []});
    const collections = [{id: 'editing', name: 'Unsaved collection edit'}];
    const settings = {statusTracker: {collections}};
    let saves = 0;
    const context = {definition: () => definition, getSettings: () => settings, saveSettings: () => saves++};
    saveSystemEditor(context);
    assert.deepEqual(settings.statusTracker.playerStats.map(field => field.id), ['health']);
    assert.deepEqual(definition.hud.playerStatIds, ['health']);
    assert.deepEqual(settings.statusTracker.npcStats.map(field => field.id), ['health']);
    definition.stats.character[0].targets = ['npc'];
    definition.stats.character[0].name = 'Vitality';
    saveSystemEditor(context);
    assert.equal(settings.statusTracker.playerStats.length, 0);
    assert.deepEqual(definition.hud.playerStatIds, []);
    assert.equal(settings.statusTracker.npcStats[0].name, 'Vitality');
    assert.equal(settings.statusTracker.collections, collections);
    assert.equal(saves, 2);
});
