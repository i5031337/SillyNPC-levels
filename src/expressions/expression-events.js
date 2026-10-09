/** Only a changed, completed foreground reply authorizes automatic presentation work. */
export function wireExpressionEvents({ events, types, renderedEvent, render, reset,
    latestId, revision, sourceToken = revision, defer, complete }) {
    let generation = null;
    let version = 0;
    const invalidate = clear => { version++; generation = null; reset({ clear }); };
    events.on(renderedEvent, render);
    events.on(types.GENERATION_STARTED, (type, _data, dryRun) => {
        if (dryRun || !['normal', 'swipe', 'regenerate', 'continue'].includes(type)) return;
        invalidate(false);
        generation = revision(latestId());
    });
    events.on(types.GENERATION_STOPPED, () => invalidate(false));
    events.on(types.GENERATION_ENDED, () => {
        if (generation === null) return;
        const source = generation;
        generation = null;
        const id = latestId(), identity = revision(id), captured = version;
        if (identity === source) return;
        const token = sourceToken(id);
        defer(() => {
            if (version === captured && sourceToken(id) === token) {
                Promise.resolve(complete(id)).catch(error => console.warn('[SillyNPC] Expressions failed', error));
            }
        });
    });
    for (const event of [types.CHAT_CHANGED, types.MESSAGE_SWIPED, types.MESSAGE_EDITED, types.MESSAGE_DELETED]) {
        events.on(event, () => invalidate(event === types.CHAT_CHANGED));
    }
}
