import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSystemDefinition } from '../src/core/system-schema.js';
import { addProfileField, renameProfileField, moveProfileField, retireProfileField }
    from '../src/ui/system/ui-system-profile-operations.js';

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
