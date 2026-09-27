import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

test('status providers uniquely supply every shared dependency', () => {
    const directory = new URL('../src/tracker/', import.meta.url);
    const providers = new Map();
    const used = new Set();
    const modules = [];
    for (const name of readdirSync(directory).filter(name => /^status-.*\.js$/.test(name))) {
        const source = readFileSync(new URL(name, directory), 'utf8');
        if (source.includes('export function bind(deps)')) modules.push(name);
        for (const match of source.matchAll(/deps\.([A-Za-z_]\w*)/g)) used.add(match[1]);
        for (const block of source.matchAll(/Object\.defineProperties\(deps,\s*\{([\s\S]*?)\}\);/g)) {
            for (const match of block[1].matchAll(/^\s*([A-Za-z_]\w*):\s*\{/gm)) {
                assert.equal(providers.has(match[1]), false,
                    `${match[1]} supplied by both ${providers.get(match[1])} and ${name}`);
                providers.set(match[1], name);
            }
        }
    }
    assert.deepEqual([...used].filter(key => !providers.has(key)), []);
    const publicApi = readFileSync(new URL('status-logic.js', directory), 'utf8');
    const registered = [...publicApi.matchAll(/from '\.\/(status-[^']+\.js)'/g)]
        .map(match => match[1]);
    assert.deepEqual(registered.sort(), modules.sort());
    for (const match of publicApi.matchAll(/export const (\w+) = deps\.(\w+);/g)) {
        assert.equal(match[1], match[2]);
        assert.equal(providers.has(match[1]), true, `${match[1]} is not provided`);
    }
});
