import { saveSettings } from '../../core/settings.js';
import { npcTemplates, npcTemplateFor } from '../../core/npc-templates.js';
import { loadStateFromMetadata, saveStateToMetadata } from '../../tracker/status-logic.js';
import { triggerReprocess } from '../../chat/reprocess.js';

export function buildNpcTemplateSelect(char, onChange, state = loadStateFromMetadata()) {
    const label = document.createElement('label');
    label.className = 'sillynpc-editor-field';
    label.textContent = 'NPC template';
    const select = document.createElement('select');
    select.className = 'text_pole sillynpc-npc-template-select';
    select.setAttribute('aria-label', 'NPC template');
    const actor = state?.characters?.find(actor => actor.name?.toLowerCase() === char.name?.toLowerCase());
    const selected = npcTemplateFor(actor?.npcTemplateId ? actor : char);
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = npcTemplates().length ? 'Choose a template (assignment required)' : 'Create NPC templates in Systems first';
    placeholder.disabled = !!selected;
    select.append(placeholder);
    for (const template of npcTemplates()) {
        const option = document.createElement('option');
        option.value = template.id; option.textContent = template.name;
        select.append(option);
    }
    select.value = selected?.id || '';
    select.addEventListener('change', () => {
        if (!npcTemplates().some(template => template.id === select.value)) return;
        char.npcTemplateId = select.value;
        if (state) {
            state.npcTemplateAssignments ||= {};
            state.npcTemplateAssignments[char.id || char.name.toLowerCase()] = select.value;
        }
        if (actor) {
            actor.npcTemplateId = select.value;
        }
        if (state) saveStateToMetadata(state, { label: 'NPC template' });
        saveSettings(); triggerReprocess(); onChange();
    });
    label.append(select);
    return label;
}
