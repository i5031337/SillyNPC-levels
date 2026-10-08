/** Profile definitions keep their IDs for the lifetime of a System. */
const slug = label => String(label).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'field';

export function addProfileField(fields, label) {
    const name = String(label || '').trim();
    if (!name) return null;
    const base = /^[a-z]/.test(slug(name)) ? slug(name) : `f-${slug(name)}`;
    const used = new Set(fields.map(field => field.id));
    let id = base;
    for (let number = 2; used.has(id); number++) id = `${base}-${number}`;
    const field = { id, label: name, guidance: '',
        placeholder: '', multiline: false, includeInImagePrompt: ['age', 'appearance'].includes(id), retired: false };
    fields.push(field);
    return field;
}

export function renameProfileField(field, label) {
    const name = String(label || '').trim();
    if (!name) return false;
    field.label = name;
    return true;
}

export function moveProfileField(fields, id, direction) {
    const active = fields.filter(field => !field.retired);
    const index = active.findIndex(field => field.id === id);
    const neighbor = active[index + direction];
    if (index < 0 || !neighbor) return false;
    const first = fields.indexOf(active[index]);
    const second = fields.indexOf(neighbor);
    [fields[first], fields[second]] = [fields[second], fields[first]];
    return true;
}

export function retireProfileField(field, retired = true) {
    field.retired = retired;
}
