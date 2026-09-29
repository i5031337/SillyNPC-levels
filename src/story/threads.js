/** Archived Threads remain readable in the Goals view. New turns never create them. */
export function getThreads(state) {
    return Array.isArray(state?.threads) ? state.threads : [];
}

/** Replays a Thread from an older saved reply. */
export function addThread(state, thread) {
    if (!state || !thread) return false;
    if (!Array.isArray(state.threads)) state.threads = [];
    const key = String(thread.quote ?? "").toLowerCase();
    if (state.threads.some(old => String(old?.quote ?? "").toLowerCase() === key)) return false;
    state.threads.push(thread);
    return true;
}

/** Replays a completion from an older saved reply. */
export function closeThread(state, id) {
    const thread = getThreads(state).find(item => item?.id === id);
    if (!thread || thread.status === "closed") return false;
    thread.status = "closed";
    return true;
}
