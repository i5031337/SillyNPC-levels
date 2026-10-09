import assert from 'node:assert/strict';
import test from 'node:test';
import { allocatePlan } from '../src/generation/plan.js';
import { SystemGenerationRun } from '../src/generation/generate-system.js';
import { validateDefinition } from '../src/generation/validate-definition.js';
import { plan, responseFor } from './fixtures/system-generation.mjs';

test('counted collections generate built-in quantity, pin the option, and reject conflicting defaults', async () => {
    const counted = structuredClone(plan);
    counted.collections = [{ name: 'Inventory', purpose: 'Consumable holdings', targets: ['player'],
        trackQuantity: true, fields: [{ name: 'Name', purpose: 'Item identifier' }], rewards: 'none' }];
    const allocated = allocatePlan(counted);
    assert.deepEqual(allocated.collections[0].fields.map(field => field.id), ['name', 'quantity']);
    const calls = [];
    const run = new SystemGenerationRun({ premise: 'Expedition inventory', request: args => {
        calls.push(args);
        return args.stage === 'plan' ? { section: counted, assumptions: [] } : responseFor(args.stage, allocated);
    } });
    const { definition } = await run.generate();
    const col = definition.collections[0];
    assert.equal(col.trackQuantity, true);
    assert.equal(col.fields[1].name, 'quantity');
    assert.equal(col.fields[1].defaultValue, '1');
    assert.equal(col.fields[1].min, '0');
    assert.equal(col.fields[1].maxStatValue, '');
    assert.deepEqual(validateDefinition(definition), []);
    const request = calls.find(call => call.stage === 'collection.inventory');
    assert.deepEqual(request.schema.properties.section.properties.trackQuantity.enum, [true]);
    assert.match(request.systemPrompt, /quantity is built in/);
    const bad = structuredClone(definition);
    bad.collections[0].fields[1].defaultValue = '2';
    assert.ok(validateDefinition(bad).some(error => /built-in quantity/.test(error)));
});
