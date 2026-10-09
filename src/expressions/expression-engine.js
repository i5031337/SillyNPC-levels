import { fnv1a } from '../core/hash.js';

export function lastNpcLines(records) {
    const lines = new Map();
    for (const line of records) if (line.npcId && !line.isPersona) lines.set(line.npcId, line);
    return [...lines.values()].sort((a, b) => a.lineIndex - b.lineIndex);
}

export function selectSprite(sprites, label, fallback, identity) {
    for (const candidate of [label, fallback]) {
        const files = sprites.filter(sprite => sprite.label === candidate).map(sprite => sprite.path).sort();
        if (files.length) return files[fnv1a(identity) % files.length];
    }
    return '';
}

/** One serialized queue and a bounded session cache; freshness is checked on both sides of requests. */
export function createExpressionEngine({ classify, isCurrent, apply, limit = 128 }) {
    const cache = new Map();
    const pending = new Map();
    let queue = Promise.resolve();
    let epoch = 0;
    return {
        reset() { epoch++; cache.clear(); pending.clear(); },
        cached(key) { return cache.get(key); },
        enqueue(job) {
            const vocabulary = [...new Set((job.sprites || []).map(sprite => sprite.label))].sort();
            const key = JSON.stringify([job.line.revision, job.line.npcId, job.line.text,
                job.config, job.preferences, vocabulary]);
            if (cache.has(key)) {
                if (isCurrent(job)) apply(job, cache.get(key));
                return Promise.resolve(cache.get(key));
            }
            if (pending.has(key)) return pending.get(key);
            const version = epoch;
            const current = () => version === epoch && isCurrent(job);
            const task = queue.then(async () => {
                if (!current()) return;
                const label = await classify(job);
                if (!current()) return;
                cache.set(key, label);
                if (cache.size > limit) cache.delete(cache.keys().next().value);
                apply(job, label);
                return label;
            }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
            pending.set(key, task);
            queue = task.catch(() => {});
            return task;
        },
    };
}
