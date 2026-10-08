import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeSystemDefinition } from '../src/core/system-schema.js';
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
    { id: 'mood', label: 'Mood', policy: 'replaceable', multiline: false },
    { id: 'origin', label: 'Origin', policy: 'anchored', multiline: true },
];
const { renderProfileFields, buildProfileBlocks } = new Function(
    'document', 'profileFieldsForCard', 'saveSettings', 'syncProfileToLore',
    `${source}\nreturn { renderProfileFields, buildProfileBlocks };`,
)(document, () => fields, () => {}, async () => {});

test('editor follows System fields and keeps retired values editable', () => {
    const char = { profile: { mood: 'Calm', origin: 'North', old_title: 'Captain' } };
    const root = new Element('div');
    renderProfileFields(char, root);
    const grid = root.children[0];
    assert.equal(grid.children.length, 2);
    assert.equal(grid.children[0].children[0].children[1].children[0].textContent,
        'Replaceable');
    assert.equal(grid.children[1].children[0].children[1].children[0].textContent,
        'Anchored');
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
    const fields = normalizeSystemDefinition({}).profiles.npc;
    const first = addProfileField(fields, 'Secret Ties');
    const second = addProfileField(fields, 'Secret Ties');
    assert.equal(first.id, 'secret-ties');
    assert.equal(second.id, 'secret-ties-2');
    assert.equal(renameProfileField(first, 'Alliances'), true);
    assert.equal(first.id, 'secret-ties');
    const before = fields.findIndex(field => field.id === first.id);
    assert.equal(moveProfileField(fields, first.id, -1), true);
    assert.equal(fields.findIndex(field => field.id === first.id), before - 1);
    retireProfileField(first);
    const normalized = normalizeSystemDefinition({ schemaVersion: 1, profiles: { player: [], npc: fields } });
    assert.deepEqual(normalized.profiles.npc.find(field => field.id === first.id), first);
    assert.equal(normalized.profiles.npc.find(field => field.id === first.id).retired, true);
    retireProfileField(first, false);
    assert.equal(first.retired, false);
});
