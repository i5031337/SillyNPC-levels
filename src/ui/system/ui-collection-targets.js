import { collectionTargets } from '../../core/collection-targets.js';
import { npcTemplates } from '../../core/npc-templates.js';

/** Checkboxes allow combinations without modifier keys or an exclusive “all” option. */
export function buildCollectionTargetsEditor(collection, onChange, templates = npcTemplates()) {
    const wrap = document.createElement('fieldset');
    wrap.className = 'col-targets';
    wrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:8px 16px; margin:0 0 12px;';
    const legend = document.createElement('legend');
    legend.textContent = 'Applies to';
    wrap.append(legend);
    const selected = collectionTargets(collection);
    const choices = [
        { value: 'player', label: 'Player' },
        { value: 'npc', label: 'All NPCs' },
        ...templates.map(template => ({ value: `template:${template.id}`, label: `NPC template: ${template.name}` })),
    ];
    for (const value of selected) {
        if (!choices.some(choice => choice.value === value)) {
            choices.push({ value, label: `Missing template: ${value.slice(9)}` });
        }
    }
    const refreshAvailability = () => {
        const allNpcs = wrap.querySelector('.col-target[value="npc"]').checked;
        for (const input of wrap.querySelectorAll('.col-target')) {
            if (!input.value.startsWith('template:')) continue;
            input.disabled = allNpcs;
            input.closest('label').classList.toggle('is-disabled', allNpcs);
            input.closest('label').title = allNpcs ? 'Included by All NPCs. Uncheck All NPCs to choose individual templates.' : '';
        }
    };
    for (const { value, label: text } of choices) {
        const label = document.createElement('label');
        label.className = 'sillynpc-check-group';
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'col-target';
        check.value = value;
        check.checked = selected.includes(value);
        check.addEventListener('change', () => {
            collection.targets = [...wrap.querySelectorAll('.col-target:checked')].map(input => input.value);
            delete collection.target;
            delete collection.npcTemplateId;
            refreshAvailability();
            onChange();
        });
        label.append(check, document.createTextNode(text));
        wrap.append(label);
    }
    refreshAvailability();
    return wrap;
}
