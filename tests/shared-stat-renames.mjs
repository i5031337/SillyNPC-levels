import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fieldAppliesTo } from '../src/core/system-fields.js';

const source = readFileSync(new URL('../src/tracker/status-stat-schema.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export function bind', 'function bind');

test('shared stat rename follows assignments and preserves other template readings', () => {
    const field = { id: 'health', name: 'Health', targets: ['player', 'template:mage'] };
    const system = { npcTemplates: [{ id: 'mage' }, { id: 'beast' }] };
    const settings = { activeSystem: 'story', statusTracker: {
        presets: { story: { definition: system } }, playerStats: [field], npcStats: [field],
    } };
    const state = { player: { stats: { Health: '4' } }, players: { inactive: { stats: { Health: '8' } } },
        characters: [{ npcTemplateId: 'mage', stats: { Health: '3' } },
            { npcTemplateId: 'beast', stats: { Health: '9' } }] };
    const cards = [{ npcTemplateId: 'mage', statusOverrides: { Health: '5' } },
        { npcTemplateId: 'beast', statusOverrides: { Health: '12' } }];
    const deps = { committedState: state, saveStateToMetadata() {} };
    const bind = new Function('fieldAppliesTo', 'getSettings', 'saveSettings', 'getLibraryCharacters',
        `${source}\nreturn bind;`)(fieldAppliesTo, () => settings, () => {}, () => cards);
    bind(deps);
    deps.renameStat('npcStats', 'Health', 'Vitality', field);
    deps.renameStat('playerStats', 'Health', 'Vitality', field);
    assert.deepEqual(state.player.stats, { Vitality: '4' });
    assert.deepEqual(state.players.inactive.stats, { Vitality: '8' });
    assert.deepEqual(state.characters[0].stats, { Vitality: '3' });
    assert.deepEqual(state.characters[1].stats, { Health: '9' });
    assert.deepEqual(cards[0].statusOverrides, { Vitality: '5' });
    assert.deepEqual(cards[1].statusOverrides, { Health: '12' });
});
