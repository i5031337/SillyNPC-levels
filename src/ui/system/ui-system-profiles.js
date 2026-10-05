import { liveSystemContext } from './ui-system-context.js';
import { addProfileField, renameProfileField, moveProfileField, retireProfileField } from './ui-system-profile-operations.js';

const POLICIES = [
    ['anchored', 'Anchored: a stable profile detail'],
    ['replaceable', 'Replaceable: a profile detail you can edit or regenerate'],
    ['memory', 'Memory: a memory field you can edit manually'],
];

function control(tag, className, value) {
    const element = document.createElement(tag);
    element.className = `text_pole ${className}`;
    if (value !== undefined) element.value = value;
    return element;
}

function button(label, title, action, disabled = false) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'menu_button';
    element.textContent = label;
    element.title = title;
    element.disabled = disabled;
    element.addEventListener('click', action);
    return element;
}

function rowFor(field, fields, onRefresh, context) {
    const { saveSettings } = context;
    const row = document.createElement('div');
    row.className = 'sillynpc-system-profile-row';
    if (field.retired) row.classList.add('is-retired');
    const header = document.createElement('div');
    header.className = 'sillynpc-system-profile-header';
    const name = control('input', 'profile-label', field.label);
    name.type = 'text';
    name.placeholder = 'Field name';
    name.setAttribute('aria-label', 'Profile field name');
    name.addEventListener('change', () => {
        if (!renameProfileField(field, name.value)) { name.value = field.label; return; }
        saveSettings();
    });
    const id = document.createElement('small');
    id.textContent = `ID: ${field.id}`;
    id.title = 'Stable storage key. Renaming this field never changes its ID or stored values.';
    const active = fields.filter(item => !item.retired);
    const at = active.indexOf(field);
    header.append(name, id);
    if (!field.retired) {
        header.append(
            button('↑', 'Move field up', () => { if (moveProfileField(fields, field.id, -1)) { saveSettings(); onRefresh(); } }, at === 0),
            button('↓', 'Move field down', () => { if (moveProfileField(fields, field.id, 1)) { saveSettings(); onRefresh(); } }, at === active.length - 1),
        );
    }
    header.append(button(field.retired ? 'Restore' : 'Retire',
        field.retired ? 'Show this field again' : 'Hide this field while preserving existing values',
        () => { retireProfileField(field, !field.retired); saveSettings(); onRefresh(); }));

    const guidance = control('textarea', 'profile-guidance', field.guidance || '');
    guidance.rows = 2;
    guidance.placeholder = 'What belongs in this field? This guides lore generation and Fill.';
    guidance.setAttribute('aria-label', `Guidance for ${field.label}`);
    guidance.addEventListener('input', () => { field.guidance = guidance.value; saveSettings(); });

    const policy = control('select', 'profile-policy');
    policy.setAttribute('aria-label', `Update policy for ${field.label}`);
    for (const [value, label] of POLICIES) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        policy.appendChild(option);
    }
    policy.value = field.policy || 'replaceable';
    policy.addEventListener('change', () => { field.policy = policy.value; saveSettings(); });

    const placeholder = control('input', 'profile-placeholder', field.placeholder || '');
    placeholder.type = 'text';
    placeholder.placeholder = 'Editor placeholder (optional)';
    placeholder.setAttribute('aria-label', `Placeholder for ${field.label}`);
    placeholder.addEventListener('input', () => { field.placeholder = placeholder.value; saveSettings(); });

    const multiline = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = field.multiline === true;
    checkbox.addEventListener('change', () => { field.multiline = checkbox.checked; saveSettings(); });
    multiline.append(checkbox, ' Multiline editor');
    const imageLabel = document.createElement('label');
    const imageCheckbox = document.createElement('input');
    imageCheckbox.type = 'checkbox';
    imageCheckbox.className = 'profile-image-prompt';
    imageCheckbox.checked = field.includeInImagePrompt === true;
    imageCheckbox.addEventListener('change', () => {
        field.includeInImagePrompt = imageCheckbox.checked;
        saveSettings();
    });
    imageLabel.append(imageCheckbox, ' Include in image prompt');
    row.append(header, guidance, policy, placeholder, multiline, imageLabel);
    return row;
}

export function buildProfilesEditor(scope, onRefresh, context = liveSystemContext) {
    const { saveSettings } = context;
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-system-profiles';
    const definition = context.definition();
    const fields = definition?.profiles?.[scope];
    if (!fields) {
        wrap.textContent = 'Select a System to edit its profile fields.';
        return wrap;
    }
    const heading = document.createElement('p');
    heading.textContent = `${scope === 'player' ? 'Player' : 'NPC'} profile fields. IDs stay fixed when names change. Retired fields keep their saved values.`;
    wrap.appendChild(heading);
    fields.filter(field => !field.retired).forEach(field => wrap.appendChild(rowFor(field, fields, onRefresh, context)));
    const add = document.createElement('div');
    add.className = 'sillynpc-system-profile-add';
    const label = control('input', 'profile-new-label');
    label.type = 'text';
    label.placeholder = 'New field name';
    label.setAttribute('aria-label', 'New profile field name');
    const addField = () => {
        if (!addProfileField(fields, label.value)) return;
        saveSettings();
        onRefresh();
    };
    label.addEventListener('keydown', event => { if (event.key === 'Enter') addField(); });
    add.append(label, button('Add field', 'Add a profile field', addField));
    wrap.appendChild(add);
    if (scope === 'npc') {
        const limitLabel = document.createElement('label');
        limitLabel.textContent = 'Memory entries per character: ';
        const limit = control('input', 'profile-memory-limit', definition.memories?.maxEntriesPerCharacter ?? 50);
        limit.type = 'number';
        limit.min = '1';
        limit.max = '500';
        limit.style.width = '6em';
        limit.addEventListener('change', () => {
            const value = Number(limit.value);
            if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
                limit.value = definition.memories?.maxEntriesPerCharacter ?? 50;
                return;
            }
            definition.memories ??= {};
            definition.memories.maxEntriesPerCharacter = value;
            saveSettings();
        });
        limitLabel.appendChild(limit);
        wrap.appendChild(limitLabel);
    }
    const retired = fields.filter(field => field.retired);
    if (retired.length) {
        const title = document.createElement('h4');
        title.textContent = 'Retired fields';
        wrap.appendChild(title);
        retired.forEach(field => wrap.appendChild(rowFor(field, fields, onRefresh, context)));
    }
    return wrap;
}
