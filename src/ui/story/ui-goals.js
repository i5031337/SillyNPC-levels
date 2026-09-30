import { hasOpenChat, loadStateFromMetadata, saveStateToMetadata } from '../../tracker/status-logic.js';
import { goalLines, setGoal } from '../../tracker/goals.js';

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

export function renderGoalEditor(actor, scope, state, redraw) {
    const fields = goalLines(actor, scope);
    if (!fields.length) return null;
    const section = element('section', 'sillynpc-goal-actor');
    section.append(element('h3', '', actor.name || (scope === 'player' ? 'Player' : 'Character')));
    for (const field of fields) {
        const row = element('label', 'sillynpc-goal-row');
        row.append(element('span', 'sillynpc-goal-label', field.label));
        const input = element('textarea', 'text_pole sillynpc-goal-input');
        input.rows = 2;
        input.value = field.value;
        input.placeholder = field.guidance;
        input.addEventListener('change', () => {
            const action = input.value.trim() ? (field.value ? 'replace' : 'set') : 'complete';
            if (setGoal(actor, field.id, input.value, { action })) {
                saveStateToMetadata(state, { label: `${field.label} edited` });
                redraw();
            }
        });
        row.append(input);
        section.append(row);
    }
    return section;
}

/** Goals are current chat fields. */
export function renderGoalsView(container) {
    container.replaceChildren();
    container.className = 'sillynpc-goals-view';
    container.append(element('h2', '', 'Goals'));
    if (!hasOpenChat()) {
        container.append(element('p', 'notes', 'Open a chat to see its goals.'));
        return;
    }
    const state = loadStateFromMetadata();
    if (!state) return;
    const redraw = () => renderGoalsView(container);
    const player = renderGoalEditor(state.player || { name: 'Player' }, 'player', state, redraw);
    if (player) container.append(player);
    for (const actor of state.characters || []) {
        const editor = renderGoalEditor(actor, 'npc', state, redraw);
        if (editor) container.append(editor);
    }
    const active = new Set((state.characters || [])
        .flatMap(actor => [actor.id, actor.name?.toLowerCase()]).filter(Boolean));
    for (const [key, actor] of Object.entries(state.npcGoals || {})) {
        if (!actor || active.has(key) || active.has(actor.name?.toLowerCase())) continue;
        const editor = renderGoalEditor(actor, 'npc', state, redraw);
        if (editor) container.append(editor);
    }
}
