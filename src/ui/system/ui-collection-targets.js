import { collectionTargets } from '../../core/collection-targets.js';
import { npcTemplates } from '../../core/npc-templates.js';

/** Checkboxes allow combinations without modifier keys or an exclusive “all” option. */
export function buildTargetsEditor(collection, onChange, templates = npcTemplates()) {
    const wrap = document.createElement('div');
    wrap.className = 'col-targets';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Applies to');
    const caption = document.createElement('span');
    caption.className = 'col-targets-caption';
    caption.textContent = 'Applies to:';
    wrap.append(caption);
    const selected = collectionTargets(collection);
    const choices = [
        { value: 'player', label: 'Player' },
        { value: 'npc', label: 'All NPCs' },
        ...templates.map(template => ({ value: `template:${template.id}`, label: template.name })),
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
            const previous = collection.targets;
            collection.targets = [...wrap.querySelectorAll('.col-target:checked')].map(input => input.value);
            if (onChange() === false) {
                collection.targets = previous;
                for (const input of wrap.querySelectorAll('.col-target')) input.checked = (previous || selected).includes(input.value);
                refreshAvailability();
                return;
            }
            delete collection.target;
            delete collection.npcTemplateId;
            refreshAvailability();
        });
        label.append(check, document.createTextNode(text));
        wrap.append(label);
    }
    refreshAvailability();
    return wrap;
}

export const buildCollectionTargetsEditor = buildTargetsEditor;
