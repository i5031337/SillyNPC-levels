import { fieldAssignmentConflicts } from '../../core/system-fields.js';
import { buildTargetsEditor } from './ui-collection-targets.js';
import { liveSystemContext, saveSystemEditor } from './ui-system-context.js';
import { addProfileField, renameProfileField, moveProfileField, retireProfileField } from './ui-system-profile-operations.js';

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
    const saveSettings = () => saveSystemEditor(context);
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
        if (fieldAssignmentConflicts(fields, field, { name: name.value }).length) {
            toastr.error('These actors already have a profile field with this name.', 'SillyNPC');
            name.value = field.label;
            return;
        }
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
        () => {
            if (field.retired && fieldAssignmentConflicts(fields, field).length) {
                toastr.error('These actors already have a profile field with this name. Change its name or targets before restoring it.', 'SillyNPC');
                return;
            }
            retireProfileField(field, !field.retired); saveSettings(); onRefresh();
        }));

    const guidance = control('textarea', 'profile-guidance', field.guidance || '');
    guidance.rows = 2;
    guidance.placeholder = 'What belongs in this field? This guides lore generation and Fill.';
    guidance.setAttribute('aria-label', `Guidance for ${field.label}`);
    guidance.addEventListener('input', () => { field.guidance = guidance.value; saveSettings(); });

    const placeholder = control('input', 'profile-placeholder', field.placeholder || '');
    placeholder.type = 'text';
    placeholder.placeholder = 'Editor placeholder (optional)';
    placeholder.setAttribute('aria-label', `Placeholder for ${field.label}`);
    placeholder.addEventListener('input', () => { field.placeholder = placeholder.value; saveSettings(); });

    const multiline = document.createElement('label');
    multiline.className = 'sillynpc-check-group';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'profile-text-section';
    checkbox.checked = field.multiline === true;
    checkbox.addEventListener('change', () => { field.multiline = checkbox.checked; saveSettings(); });
    multiline.append(checkbox, ' Display as text section');
    multiline.title = 'Unchecked fields display as compact badges. All profile editors support multiple lines.';
    const imageLabel = document.createElement('label');
    imageLabel.className = 'sillynpc-check-group';
    const imageCheckbox = document.createElement('input');
    imageCheckbox.type = 'checkbox';
    imageCheckbox.className = 'profile-image-prompt';
    imageCheckbox.checked = field.includeInImagePrompt === true;
    imageCheckbox.addEventListener('change', () => {
        field.includeInImagePrompt = imageCheckbox.checked;
        saveSettings();
    });
    imageLabel.append(imageCheckbox, ' Include in image prompt');
    const displayOptions = document.createElement('div');
    displayOptions.className = 'sillynpc-system-profile-options';
    displayOptions.append(multiline, imageLabel);
    row.append(header, buildTargetsEditor(field, () => {
        if (fieldAssignmentConflicts(fields, field).length) {
            toastr.error('These actors already have a profile field with this name. Rename it or choose other targets.', 'SillyNPC');
            return false;
        }
        saveSettings(); onRefresh();
    }, context.definition().npcTemplates), guidance, placeholder, displayOptions);
    return row;
}

export function buildProfilesEditor(onRefresh, context = liveSystemContext) {
    const saveSettings = () => saveSystemEditor(context);
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-system-profiles';
    const definition = context.definition();
    const fields = definition?.profiles;
    if (!fields) {
        wrap.textContent = 'Select a System to edit its profile fields.';
        return wrap;
    }
    fields.filter(field => !field.retired).forEach(field => wrap.appendChild(rowFor(field, fields, onRefresh, context)));
    const add = document.createElement('div');
    add.className = 'sillynpc-system-profile-add';
    const label = control('input', 'profile-new-label');
    label.type = 'text';
    label.placeholder = 'New field name';
    label.setAttribute('aria-label', 'New profile field name');
    const addField = () => {
        if (fieldAssignmentConflicts(fields, { label: label.value, targets: ['player', 'npc'] }).length) {
            toastr.error('A profile field with this name already exists. Assign that field to more actors instead.', 'SillyNPC');
            return;
        }
        if (!addProfileField(fields, label.value)) return;
        saveSettings();
        onRefresh();
    };
    label.addEventListener('keydown', event => { if (event.key === 'Enter') addField(); });
    add.append(label, button('Add field', 'Add a profile field', addField));
    wrap.appendChild(add);
    wrap.appendChild(buildMemoryControls(definition, saveSettings, context.refreshMemoryButton));
    const retired = fields.filter(field => field.retired);
    if (retired.length) {
        const title = document.createElement('h4');
        title.textContent = 'Retired fields';
        wrap.appendChild(title);
        retired.forEach(field => wrap.appendChild(rowFor(field, fields, onRefresh, context)));
    }
    return wrap;
}

function buildMemoryControls(definition, saveSettings, refreshMemoryButton) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-system-memory-controls';
    definition.memories ??= { enabled: false, guidance: '', interval: 8, maxEntriesPerCharacter: 50 };
    const memories = definition.memories;
    const title = document.createElement('h4');
    title.textContent = 'NPC memories';
    const enabledLabel = document.createElement('label');
    const enabled = document.createElement('input');
    enabled.className = 'profile-memory-enabled';
    enabled.type = 'checkbox';
    enabled.checked = memories.enabled === true;
    enabled.addEventListener('change', () => { memories.enabled = enabled.checked; saveSettings(); refreshMemoryButton?.(); });
    enabledLabel.append(enabled, ' Automatically propose NPC memories for review');
    const help = document.createElement('p');
    help.textContent = 'A separate reader occasionally proposes durable events and knowledge for NPCs. Manual memory editing is always available.';
    const guidance = control('textarea', 'profile-memory-guidance', memories.guidance || '');
    guidance.rows = 3;
    guidance.maxLength = 4000;
    guidance.placeholder = 'Optional genre guidance: remember significant battles, promises, rivalries, or personally discovered clues. Skip routine activity.';
    guidance.setAttribute('aria-label', 'Memorable-event guidance');
    guidance.addEventListener('input', () => { memories.guidance = guidance.value; saveSettings(); });
    wrap.append(title, enabledLabel, help, guidance);
    for (const [key, label, fallback, max, className] of [
        ['interval', 'Read every N assistant replies: ', 8, 100, 'profile-memory-interval'],
        ['maxEntriesPerCharacter', 'Active memory entries per character: ', 50, 500, 'profile-memory-limit'],
    ]) {
        const numericLabel = document.createElement('label');
        numericLabel.textContent = label;
        const input = control('input', className, memories[key] ?? fallback);
        input.type = 'number';
        input.min = '1';
        input.max = String(max);
        input.step = '1';
        input.style.width = '6em';
        input.setAttribute('aria-label', label.trim().replace(/:$/, ''));
        input.addEventListener('change', () => {
            const value = Number(input.value);
            if (!Number.isSafeInteger(value) || value < 1 || value > max) {
                input.value = memories[key] ?? fallback;
                return;
            }
            memories[key] = value;
            saveSettings();
        });
        numericLabel.appendChild(input);
        wrap.appendChild(numericLabel);
    }
    return wrap;
}
