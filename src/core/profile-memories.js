/** Sourced character memories. All operations return new data and leave input untouched. */
const DEFAULT_LIMIT = 50;
const cleanText = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const dedupeText = value => cleanText(value).toLocaleLowerCase();

/** Two independent 32-bit hashes plus length keep stored provenance compact. */
export function memoryTextFingerprint(text) {
    const value = String(text ?? '');
    let first = 2166136261;
    let second = 5381;
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        first = Math.imul(first ^ code, 16777619);
        second = Math.imul(second, 33) ^ code;
    }
    return `${value.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

/** Snapshots keep memories tied to the reply/swipe that established them. */
export function normalizeMemorySources(values) {
    if (!Array.isArray(values)) return [];
    const seen = new Set();
    return values.filter(value => value && Number.isSafeInteger(value.messageId)
        && value.messageId >= 0 && (typeof value.fingerprint === 'string' || typeof value.text === 'string')).map(value => ({
        messageId: value.messageId,
        swipeId: Number.isSafeInteger(value.swipeId) ? value.swipeId : 0,
        fingerprint: value.fingerprint ?? memoryTextFingerprint(value.text),
        ...(typeof value.isUser === 'boolean' ? { isUser: value.isUser } : {}),
        ...(typeof value.speaker === 'string' ? { speaker: value.speaker } : {}),
    })).filter(value => !seen.has(value.messageId) && seen.add(value.messageId));
}

export function firstChangedMemorySource(messages, sources) {
    const changed = normalizeMemorySources(sources).filter(source => {
        const message = messages?.[source.messageId];
        return !message || message.is_system || memoryTextFingerprint(message.mes) !== source.fingerprint
            || Number(message.swipe_id ?? 0) !== source.swipeId
            || (source.speaker !== undefined && String(message.name ?? '') !== source.speaker)
            || (source.isUser !== undefined && Boolean(message.is_user) !== source.isUser);
    });
    return changed.length ? Math.min(...changed.map(source => source.messageId)) : null;
}

export function memorySourcesMatch(messages, sources) {
    return firstChangedMemorySource(messages, sources) === null;
}

export function memoryLimit(value) {
    return Number.isSafeInteger(value) && value >= 1 && value <= 500 ? value : DEFAULT_LIMIT;
}

function normalizeEntry(value) {
    const old = typeof value === 'string' ? { text: value } : value;
    if (!old || typeof old !== 'object' || Array.isArray(old)) return null;
    const text = cleanText(old.text);
    if (!text) return null;
    const sourceMessageId = old.sourceMessageId == null ? '' : String(old.sourceMessageId).trim();
    const sources = normalizeMemorySources(old.provenance?.sources);
    const entry = {
        id: typeof old.id === 'string' ? old.id.trim() : '',
        text,
        ...(old.fieldId ? { fieldId: String(old.fieldId) } : {}),
        ...(sourceMessageId ? { sourceMessageId } : {}),
        ...(sources.length ? { provenance: {
            systemId: String(old.provenance.systemId ?? ''), sources,
            ...(old.provenance.chatId !== undefined ? { chatId: String(old.provenance.chatId) } : {}),
        } } : {}),
        ...(!sources.length && !sourceMessageId || old.manual === true ? { manual: true } : {}),
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

/** A changed source invalidates automatic memories, including archived ones. */
export function invalidateMemoryStore(source, messages, systemId) {
    const store = normalizeMemoryStore(source, 500);
    const removed = [];
    let rewindTo = null;
    const valid = entry => {
        if (entry.manual || entry.editedManually || !entry.provenance?.sources?.length) return true;
        const changed = firstChangedMemorySource(messages, entry.provenance.sources);
        const wrongSystem = systemId !== undefined && entry.provenance.systemId !== String(systemId);
        if (changed === null && !wrongSystem) return true;
        removed.push(entry);
        const from = changed ?? Math.min(...entry.provenance.sources.map(item => item.messageId));
        rewindTo = rewindTo === null ? from - 1 : Math.min(rewindTo, from - 1);
        return false;
    };
    store.entries = store.entries.filter(valid);
    store.archive = store.archive.filter(valid);
    return { store, removed, rewindTo };
}
