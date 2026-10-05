/** Narrow each request to its section and constrain references to the allocated registry. */
function choices(schema, values) {
    if (values.length) schema.enum = [...new Set(values)];
}
function selections(schema, ids, exact = false) {
    choices(schema.items, ids);
    schema.maxItems = ids.length;
    schema.minItems = exact ? ids.length : 0;
}
export function stageRequestSchema(stage) {
    // Schema fragments reuse leaf objects; detach each path before narrowing its enum.
    const schema = JSON.parse(JSON.stringify(stage.schema));
    const expected = stage.expected;
    if (expected) {
        const fields = stage.owners?.length ? schema.properties.fields : schema;
        const item = fields.type === 'array' ? fields.items : fields;
        choices(item.properties.id, expected.map(field => field.id));
        if (fields.type === 'array') fields.minItems = fields.maxItems = expected.length;
    }
    for (const owner of stage.owners || []) {
        const config = schema.properties.progression.properties[owner.id];
        config.properties.enabled.enum = [true];
        config.properties.xpFieldId.enum = [owner.config.xpFieldId];
        config.properties.levelFieldId.enum = [owner.config.levelFieldId];
        const ids = (owner.statIds || expected.map(field => field.id)).filter(id => ![owner.config.xpFieldId, owner.config.levelFieldId].includes(id));
        selections(config.properties.statIds, ids);
    }
    if (stage.id.startsWith('collection.')) {
        const col = expected[0];
        const fields = schema.properties.fields;
        fields.minItems = fields.maxItems = col.fields.length;
        choices(fields.items.properties.id, col.fields.map(field => field.id));
        selections(schema.properties.targets, col.targets, true);
    }
    return schema;
}
export function stageRequestContext(stage, plan, definition) {
    const context = { system: { name: plan.name, description: plan.description, rationale: plan.rationale } };
    if (stage.expected) context.expectedObjects = stage.expected;
    if (stage.id.startsWith('stats.')) {
        const scope = stage.id.slice(6);
        context.catalogScope = scope;
        context.progressionOwners = scope === 'world' ? [] : scope === 'player'
            ? [{ owner: 'player', ...plan.playerProgression }]
            : plan.npcTemplates.map(t => ({ owner: t.id, name: t.name, statIds: t.statIds, ...t.progression }));
        context.counterRequirements = (stage.owners || []).map(owner => ({ owner: owner.id,
            xp: { id: owner.config.xpFieldId, type: 'number', defaultValueExample: '0/100', maxStatValueExample: '100', rule: 'Integer remainder/capacity STRING; maximum equals capacity, never plain 0 or blank.' },
            level: { id: owner.config.levelFieldId, type: 'number', defaultValueExample: '1', updatePolicy: 'advancement' } }));
    } else if (stage.id.startsWith('collection.')) {
        const targets = stage.expected[0].targets;
        context.npcTemplates = definition.npcTemplates.filter(t => targets.includes('npc') || targets.includes(`template:${t.id}`));
    } else if (stage.id.startsWith('rewards.')) {
        context.rewardIntent = plan.collections.find(c => `rewards.${c.id}` === stage.id).rewards;
    }
    return context;
}
export function stageInstructions(stage) {
    let instruction = `Complete ONLY task ${stage.id}. The supplied schema defines exactly what section may contain. Do not redesign the plan or fill other catalogs. When expectedObjects is supplied, return each listed object exactly once and COPY its id verbatim, character for character. Never slugify, abbreviate, suffix, rename, duplicate, or invent IDs. Purpose and other planning notes explain intent; omit planning-only properties from the response.`;
    if (stage.id.startsWith('stats.')) instruction += ` For stats use type "number" or "text" only; resource pools are type "number". min, maxStatValue, and maxLength are STRINGS: for example "0", "100", or "" when unset. Never use numbers or null for those properties.`;
    if (stage.owners?.length) instruction += ` This task defines stats AND their progression together: section.fields contains the exact expectedObjects; section.progression contains the enabled owners listed by the schema. XP defaultValue MUST be a string integer remainder/capacity such as "0/100", and maxStatValue MUST be the matching capacity string "100". A plain XP value such as "0" is invalid. Level starts at integer 1 or higher and is not a pool. Follow counterRequirements. Choose growth candidates only from that owner's selected numeric stats excluding XP and Level. All selected stats receive independent reader-chosen increases from 0 through 3 at each level; One stat receives a reader-chosen increase from 1 through 5. Use statGrowth "none", statIds [] if no stats should grow. Do not modify other catalogs.`;
    if (stage.id === 'stats.npc') instruction += ` This is ONE SHARED NPC catalog, not separate catalogs for humans and creatures. Templates select the shared IDs later. A shared field gets one definition and one default for all selecting templates. Do not add human/creature suffixes such as _h or _c. If the plan explicitly lists separate fields, use their already allocated IDs exactly.`;
    if (stage.id.startsWith('profiles.')) instruction += ` Fill only the expected profile attributes; stats are handled by a separate task.`;
    return instruction;
}
