/** Keep synthesis ahead of ordered playback without buffering an entire message. */
export function createSpeechQueue({ synthesize, playAudio, valid, onState = () => {} }) {
    let active = null;
    let serial = 0;
    const stop = () => {
        if (!active) return;
        const job = active;
        active = null;
        job.controller.abort();
        onState('idle', job);
    };
    const play = async (messageId, revision, units) => {
        stop();
        const job = { id: ++serial, messageId, revision, controller: new AbortController() };
        active = job;
        onState('working', job);
        const spoken = units.filter(unit => unit.voice);
        const consumed = spoken.map(() => {
            let release;
            const promise = new Promise(resolve => { release = resolve; });
            return { promise, release };
        });
        const current = () => active === job && !job.controller.signal.aborted && valid(job);
        const ready = [];
        for (let i = 0; i < spoken.length; i++) {
            const previous = i ? ready[i - 1] : Promise.resolve(null);
            const space = i >= 3 ? consumed[i - 3].promise : Promise.resolve();
            ready.push(Promise.all([previous, space]).then(async ([prior]) => {
                if (prior?.error || prior?.skip || !current()) return { skip: true };
                return { blob: await synthesize(spoken[i], job.controller.signal) };
            }).catch(error => ({ error })));
        }
        try {
            for (let i = 0; i < spoken.length; i++) {
                const result = await ready[i];
                if (!current()) break;
                if (result.error) throw result.error;
                if (result.skip) break;
                onState('playing', job, spoken[i]);
                await playAudio(result.blob, job.controller.signal);
                consumed[i].release();
            }
        } catch (error) {
            if (active === job && !job.controller.signal.aborted) onState('error', job, error);
        } finally {
            job.controller.abort();
            consumed.forEach(item => item.release());
            if (active === job) { active = null; onState('idle', job); }
        }
    };
    return { play, stop, current: () => active };
}
