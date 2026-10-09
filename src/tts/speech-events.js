/** Authorize automatic speech only for changed, completed foreground replies. */
export function wireSpeechEvents({ events, types, renderedEvent, render, stop,
    latestId, revision, sourceToken, defer, complete }) {
    let generation = null;
    let version = 0;
    const invalidate = () => { version++; generation = null; stop(); };
    events.on(renderedEvent, render);
    events.on(types.GENERATION_STARTED, (type, _data, dryRun) => {
        if (dryRun || !['normal', 'swipe', 'regenerate', 'continue'].includes(type)) return;
        invalidate();
        generation = revision(latestId());
    });
    events.on(types.GENERATION_STOPPED, invalidate);
    events.on(types.GENERATION_ENDED, () => {
        if (generation === null) return;
        const before = generation;
        generation = null;
        const id = latestId(), after = revision(id), token = sourceToken(id), captured = version;
        if (after === before) return;
        defer(() => {
            if (version !== captured || sourceToken(id) !== token) return;
            Promise.resolve(complete(id)).catch(error => console.warn('[SillyNPC] Automatic speech failed', error));
        });
    });
    for (const event of [types.CHAT_CHANGED, types.MESSAGE_SWIPED, types.MESSAGE_EDITED,
        types.MESSAGE_DELETED]) events.on(event, invalidate);
}
