/** Sourced character memories. All operations return new data and leave input untouched. */
const DEFAULT_LIMIT = 50;
const cleanText = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const dedupeText = value => cleanText(value).toLocaleLowerCase();

export function memoryLimit(value) {
    return Number.isSafeInteger(value) && value >= 1 && value <= 500 ? value : DEFAULT_LIMIT;
}

function normalizeEntry(value) {
    const old = typeof value === 'string' ? { text: value } : value;
    if (!old || typeof old !== 'object' || Array.isArray(old)) return null;
    const text = cleanText(old.text);
    if (!text) return null;
    const sourceMessageId = old.sourceMessageId == null ? '' : String(old.sourceMessageId).trim();
    const entry = {
        id: typeof old.id === 'string' ? old.id.trim() : '',
        text,
        ...(old.fieldId ? { fieldId: String(old.fieldId) } : {}),
        ...(sourceMessageId ? { sourceMessageId } : { manual: true }),
    };
    if (old.editedManually === true) entry.editedManually = true;
    return entry;
}

function nextId(used) {
    for (let number = 1; ; number++) {
        const id = `memory-${number}`;
        if (!used.has(id)) { used.add(id); return id; }
    }
}

/** Accepts old string arrays and the current {entries, archive} shape. */
export function normalizeMemoryStore(source, limit = DEFAULT_LIMIT) {
    const record = Array.isArray(source) ? { entries: source } : source || {};
    const archive = Array.isArray(record.archive) ? record.archive : [];
    const entries = Array.isArray(record.entries) ? record.entries : [];
    const used = new Set();
    const reserved = new Set([...archive, ...entries]
        .filter(value => value && typeof value === 'object' && typeof value.id === 'string')
        .map(value => value.id.trim()).filter(Boolean));
    const convert = values => values.map(normalizeEntry).filter(Boolean).map(entry => {
        if (!entry.id || used.has(entry.id)) entry.id = nextId(reserved);
        used.add(entry.id);
        return entry;
    });
    const result = { archive: convert(archive), entries: convert(entries) };
    const overflow = Math.max(0, result.entries.length - memoryLimit(limit));
    if (overflow) result.archive.push(...result.entries.splice(0, overflow));
    return result;
}

/** Dedupe a repeated memory across turns by field and text. */
export function appendMemory(source, candidate, limit = DEFAULT_LIMIT) {
    const store = normalizeMemoryStore(source, limit);
    const entry = normalizeEntry(candidate);
    if (!entry) return { store, added: false };
    const key = `${entry.fieldId || ''}\0${dedupeText(entry.text)}`;
    if ([...store.archive, ...store.entries].some(old =>
        `${old.fieldId || ''}\0${dedupeText(old.text)}` === key)) {
        return { store, added: false };
    }
    const used = new Set([...store.archive, ...store.entries].map(old => old.id));
    entry.id = entry.id && !used.has(entry.id) ? entry.id : nextId(used);
    store.entries.push(entry);
    const overflow = store.entries.length - memoryLimit(limit);
    if (overflow > 0) store.archive.push(...store.entries.splice(0, overflow));
    return { store, added: true };
}

/** Manual correction works for active and archived entries, retaining provenance. */
export function editMemory(source, id, text) {
    const store = normalizeMemoryStore(source, 500);
    const entry = [...store.archive, ...store.entries].find(item => item.id === id);
    const cleaned = cleanText(text);
    if (entry && cleaned) { entry.text = cleaned; entry.editedManually = true; }
    return store;
}

export function removeMemory(source, id) {
    const store = normalizeMemoryStore(source, 500);
    store.archive = store.archive.filter(entry => entry.id !== id);
    store.entries = store.entries.filter(entry => entry.id !== id);
    return store;
}
