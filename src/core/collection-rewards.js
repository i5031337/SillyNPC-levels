/** Pure collection reward contracts. Authoring never writes holdings or the Item Library. */
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value : [];
const positiveInteger = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const fieldsFor = collection => list(collection?.fields).filter(field => !field.retired);
const fieldKey = field => field.id || field.name;

export function normalizeCollectionRewards(source, collection) {
    const input = object(source);
    const used = new Set();
    return {
        enabled: input.enabled === true,
        mode: input.mode === 'scheduled' ? 'scheduled' : 'guided',
        guidance: typeof input.guidance === 'string' ? input.guidance : '',
        interval: positiveInteger(input.interval) ? Number(input.interval) : 1,
        schedule: list(input.schedule).map((row, index) => {
            let id = typeof row?.id === 'string' && row.id.trim() ? row.id.trim() : `reward-${index + 1}`;
            const base = id;
            for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
            used.add(id);
            const incoming = object(row?.entry);
            const entry = {};
            for (const field of fieldsFor(collection)) {
                const value = incoming[fieldKey(field)] ?? incoming[field.name];
                if (value !== undefined) entry[fieldKey(field)] = structuredClone(value);
            }
            return { id, level: positiveInteger(row?.level) ? Number(row.level) : 0, entry };
        }),
    };
}

/** Validate strictly before proposing a reward; bounds are errors, never silently clamped. */
export function validateRewardEntry(collection, source) {
    const incoming = object(source);
    const entry = {};
    const errors = [];
    const fields = fieldsFor(collection);
    const primary = fields.find(field => field.isPrimary) || fields[0];
    if (!primary) return { entry: null, errors: ['The collection needs an identifier field.'] };
    for (const field of fields) {
        if (field.locked) continue;
        let value = incoming[fieldKey(field)] ?? incoming[field.name];
        const supplied = value !== undefined;
        if (!supplied && field !== primary && field.defaultValue !== undefined && field.defaultValue !== '') {
            value = field.defaultValue;
            if (field.type === 'number') value = Number(value);
            if (field.type === 'boolean' && ['true', 'false'].includes(value)) value = value === 'true';
        }
        if (value === undefined) {
            if (field === primary) errors.push(`${field.label || field.name} is required.`);
            continue;
        }
        const label = field.label || field.name;
        if (field.type === 'number') {
            if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${label} must be a finite number.`);
            else {
                for (const [bound, relation] of [[field.min, 'min'], [field.maxStatValue, 'max']]) {
                    if (bound === '' || bound === undefined || bound === null) continue;
                    const limit = Number(bound);
                    if (!Number.isFinite(limit) || (relation === 'min' ? value < limit : value > limit)) {
                        errors.push(`${label} must respect its configured ${relation}imum (${bound}).`);
                    }
                }
            }
        } else if (field.type === 'boolean') {
            if (typeof value !== 'boolean') errors.push(`${label} must be true or false.`);
        } else if (typeof value !== 'string') errors.push(`${label} must be text.`);
        else if (field === primary && !value.trim()) errors.push(`${label} is required.`);
        if (list(field.options).length && !field.options.map(String).includes(String(value))) {
            errors.push(`${label} must be one of its allowed values.`);
        }
        entry[field.name] = value;
    }
    if (primary.locked) errors.push('The identifier field is locked.');
    return { entry: errors.length ? null : entry, errors };
}

export function rewardIdentifier(collection, entry) {
    const fields = fieldsFor(collection);
    const primary = fields.find(field => field.isPrimary) || fields[0];
    const value = primary && (entry?.[fieldKey(primary)] ?? entry?.[primary.name]);
    return value === undefined || value === null ? '' : String(value).toLowerCase();
}

export function hasRewardDuplicate(collection, entry, holdings = [], proposals = []) {
    const identifier = rewardIdentifier(collection, entry);
    return !identifier || [...list(holdings), ...list(proposals)].some(item =>
        rewardIdentifier(collection, item?.entry || item) === identifier);
}

/** Pure targeting equivalent to collection targets, with a resolved template ID. */
export function collectionRewardAppliesTo(collection, scope, templateId) {
    if (!collection || collection.retired) return false;
    const targets = Array.isArray(collection.targets) ? collection.targets
        : collection.target === 'npc' && collection.npcTemplateId ? [`template:${collection.npcTemplateId}`]
            : [collection.target || 'all'];
    return targets.includes('all') || targets.includes(scope)
        || (scope === 'npc' && !!templateId && targets.includes(`template:${templateId}`));
}

export function scheduledCollectionRewards(collection, levels, { holdings = [], proposals = [] } = {}) {
    const config = normalizeCollectionRewards(collection?.levelUpRewards, collection);
    if (!config.enabled || config.mode !== 'scheduled' || collection?.retired) return [];
    const crossed = new Set(list(levels).filter(positiveInteger).map(Number));
    const rewards = [];
    for (const row of config.schedule) {
        if (!crossed.has(row.level)) continue;
        const validated = validateRewardEntry(collection, row.entry);
        if (!validated.entry || hasRewardDuplicate(collection, validated.entry, holdings, [...proposals, ...rewards])) continue;
        rewards.push({ id: row.id, level: row.level, entry: validated.entry });
    }
    return rewards;
}

export function guidedRewardLevels(collection, levels) {
    const config = normalizeCollectionRewards(collection?.levelUpRewards, collection);
    if (!config.enabled || config.mode !== 'guided' || collection?.retired) return [];
    return [...new Set(list(levels).filter(positiveInteger).map(Number))]
        .filter(level => level % config.interval === 0);
}
