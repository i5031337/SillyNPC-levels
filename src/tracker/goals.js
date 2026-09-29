let settingsProvider = () => null;

export function setGoalSettingsProvider(provider) {
    settingsProvider = provider;
}

const GOAL_FIELDS = {
    player: [
        { id: 'shortTerm', label: 'Short-term goal', guidance: 'What the player is trying to achieve now.', option: 'playerShortTerm' },
        { id: 'longTerm', label: 'Long-term goal', guidance: 'The player’s larger aim.', option: 'playerLongTerm' },
    ],
    npc: [
        { id: 'shortTerm', label: 'Short-term goal', guidance: 'What this character is trying to achieve now.', option: 'npcShortTerm' },
    ],
};

/** Current goal fields are configured by the active System, never copied into it. */
export function goalFields(scope, settings = settingsProvider()) {
    const name = settings?.activeSystem;
    const options = settings?.statusTracker?.presets?.[name]?.definition?.goals || {};
    return (GOAL_FIELDS[scope] || []).filter(field => options[field.option] !== false)
        .map(({ option, ...field }) => field);
}

export function goalValue(actor, fieldId) {
    return typeof actor?.goals?.[fieldId] === 'string' ? actor.goals[fieldId] : '';
}

/** Apply a sourced reader or manual goal change to one chat-state actor. */
export function setGoal(actor, fieldId, text, { messageId = null, quote = '', action = 'set' } = {}) {
    if (!actor || !['shortTerm', 'longTerm'].includes(fieldId)
        || !['set', 'replace', 'complete'].includes(action)) return false;
    const current = goalValue(actor, fieldId);
    const next = action === 'complete' ? '' : String(text ?? '').trim();
    if (action === 'set' && current || action !== 'set' && !current
        || action !== 'complete' && !next || current === next) return false;
    if (!actor.goals || typeof actor.goals !== 'object') actor.goals = {};
    if (!actor.goalSources || typeof actor.goalSources !== 'object') actor.goalSources = {};
    actor.goals[fieldId] = next;
    actor.goalSources[fieldId] = { messageId, quote: String(quote ?? ''), action };
    return true;
}

/** Visible, configured goals, suitable for sheets, HUD and prompts. */
export function goalLines(actor, scope, settings = settingsProvider()) {
    return goalFields(scope, settings).map(field => ({
        ...field, value: goalValue(actor, field.id), source: actor?.goalSources?.[field.id] || null,
    }));
}

/** The scene list is transient; the chat keeps the last goal for an offstage NPC. */
export function goalActorFor(state, name, cardId = null) {
    const key = String(name || '').toLowerCase();
    return state?.characters?.find(actor => (cardId && actor.id === cardId)
        || actor.name?.toLowerCase() === key)
        || (cardId && state?.npcGoals?.[cardId]) || state?.npcGoals?.[key] || null;
}

export function archiveNpcGoals(state, actor) {
    if (!state || !actor?.name) return false;
    if (!actor.goals && !actor.goalSources) return false;
    if (!state.npcGoals || typeof state.npcGoals !== 'object') state.npcGoals = {};
    state.npcGoals[actor.id || actor.name.toLowerCase()] = {
        id: actor.id || null,
        name: actor.name,
        goals: structuredClone(actor.goals || {}),
        goalSources: structuredClone(actor.goalSources || {}),
    };
    return true;
}
