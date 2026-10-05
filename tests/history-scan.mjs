import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/story/history-scan.js', import.meta.url), 'utf8')
    .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
    .replaceAll('export ', '');
const { stripStats, mergeFindings } = new Function(
    `${source}\nreturn { stripStats, mergeFindings };`)();

test('history scan retains template assignments while removing ordinary stats', () => {
    const parsed = { player: { stats: { HP: '100' }, collections: { items: [] } },
        characters: [{ name: 'Mira', npcTemplateId: 'scout', stats: { HP: '100' },
            collections: { items: [{ name: 'Compass' }] } }],
    };
    const stripped = stripStats(parsed);
    assert.equal(stripped.characters[0].npcTemplateId, 'scout');
    assert.equal('stats' in stripped.characters[0], false);
    assert.equal('stats' in stripped.player, false);
    const merged = { player: { collections: {} }, characters: [] };
    mergeFindings(merged, stripped);
    mergeFindings(merged, stripStats({ characters: [{ name: 'Mira', collections: {
        items: [{ name: 'Map' }],
    } }] }));
    assert.equal(merged.characters[0].npcTemplateId, 'scout');
    assert.deepEqual(merged.characters[0].collections.items.map(item => item.name), ['Compass', 'Map']);
});
