/** Keep the existing identifier at the top; fields without one use name, then the first field. */
export function ensureCollectionIdentifier(collection) {
    let changed = false;
    if (!Array.isArray(collection.fields) || !collection.fields.length) {
        collection.fields = [{ id: 'name', name: 'name', label: 'Name', type: 'text',
            isPrimary: true, isStatic: true, isMultiline: false, guidance: '', retired: false, defaultValue: '' }];
        return true;
    }
    const fields = collection.fields;
    const selected = fields.findIndex(field => field.isPrimary);
    const named = fields.findIndex(field => field.name === 'name');
    const index = selected >= 0 ? selected : named >= 0 ? named : 0;
    if (index > 0) {
        fields.unshift(fields.splice(index, 1)[0]);
        changed = true;
    }
    fields.forEach((field, index) => {
        if (field.isPrimary !== (index === 0)) {
            field.isPrimary = index === 0;
            changed = true;
        }
    });
    if (fields[0].isStatic !== true) {
        fields[0].isStatic = true;
        changed = true;
    }
    return changed;
}

/** The identifier stays in place when arranging the remaining fields. */
export function moveCollectionField(collection, index, delta) {
    const next = index + delta;
    if (index < 1 || index >= collection.fields.length || next < 1 || next >= collection.fields.length) return false;
    [collection.fields[index], collection.fields[next]] = [collection.fields[next], collection.fields[index]];
    return true;
}

export function deleteCollectionField(collection, index) {
    if (index < 1 || index >= collection.fields.length) return false;
    collection.fields.splice(index, 1);
    return true;
}

/** Quantity is built in; existing quantity keys retain their saved values. */
export function collectionQuantityField(collection) {
    if (!collection || collection.trackQuantity === false) return null;
    return collection.fields?.find(field => !field.isPrimary && field.type === 'number'
        && ['quantity', 'qty', 'count'].includes(field.name)) || null;
}

export function ensureCollectionQuantity(collection) {
    const before = JSON.stringify(collection);
    const existing = collectionQuantityField(collection);
    collection.trackQuantity = typeof collection.trackQuantity === 'boolean' ? collection.trackQuantity : !!existing;
    if (collection.trackQuantity) {
        const field = existing || collection.fields.find(field => !field.isPrimary && field.name === 'quantity')
            || { id: 'quantity', name: 'quantity', label: 'Quantity', guidance: '' };
        Object.assign(field, { type: 'number', defaultValue: '1', isPrimary: false,
            isStatic: false, isMultiline: false, retired: false, min: '0', maxStatValue: '' });
        delete field.options;
        if (!collection.fields.includes(field)) {
            const ids = new Set(collection.fields.map(entry => entry.id));
            for (let i = 2; ids.has(field.id); i++) field.id = `quantity-${i}`;
            collection.fields.push(field);
        }
    }
    return before !== JSON.stringify(collection);
}
