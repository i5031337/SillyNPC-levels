import assert from 'node:assert/strict';
import test from 'node:test';
import { HUD_LAYOUTS, hudLayoutFor, normalizeHudLayoutId } from '../src/core/constants-base.js';
import { normalizeSystemDefinition } from '../src/core/system-schema.js';

test('retired HUD layouts resolve to a supported style', () => {
    assert.deepEqual(HUD_LAYOUTS.map(layout => layout.id),
        ['plate', 'underline', 'pips', 'splitring']);
    for (const [oldId, currentId] of Object.entries({
        blades: 'plate', dock: 'plate', fan: 'underline', brackets: 'underline',
    })) {
        assert.equal(normalizeHudLayoutId(oldId), currentId);
        assert.equal(hudLayoutFor(oldId).id, currentId);
        assert.equal(normalizeSystemDefinition({ schemaVersion: 1, hud: { layout: oldId } })
            .hud.layout, currentId);
    }
    assert.equal(hudLayoutFor('unknown').id, 'plate');
});
