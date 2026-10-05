import { normalizeCollectionRewards, validateRewardEntry } from '../../core/collection-rewards.js';

/** Reward definitions belong to the System, and never populate a character's holdings. */
export function buildCollectionRewardsEditor(collection, save) {
    const config = normalizeCollectionRewards(collection.levelUpRewards, collection);
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-collection-rewards';
    wrap.style.cssText = 'width:100%; margin-top:12px;';
    const persist = () => { collection.levelUpRewards = config; save(); };
    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'sillynpc-check-group';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.className = 'col-rewards-enabled';
    enabled.checked = config.enabled;
    enabledLabel.append(enabled, document.createTextNode(' Level-up rewards'));
    const options = document.createElement('div');
    options.className = 'col-rewards-options';
    options.hidden = !config.enabled;
    const note = document.createElement('p');
    note.className = 'notes';
    note.textContent = 'Uses this collection’s targets. Earned entries await tracker review; authoring a reward does not add it to holdings or the Item Library.';
    const mode = document.createElement('select');
    mode.className = 'text_pole col-rewards-mode';
    mode.setAttribute('aria-label', 'Collection reward mode');
    for (const [value, text] of [['guided', 'Guided'], ['scheduled', 'Scheduled']]) {
        mode.add(new Option(text, value));
    }
    mode.value = config.mode;
    const content = document.createElement('div');
    content.style.cssText = 'display:flex; flex-direction:column; gap:8px; margin-top:8px;';
    const render = () => {
        content.replaceChildren();
        if (config.mode === 'guided') renderGuided(content, config, persist);
        else renderSchedule(content, collection, config, persist);
    };
    enabled.addEventListener('change', () => {
        config.enabled = enabled.checked;
        options.hidden = !config.enabled;
        persist();
    });
    mode.addEventListener('change', () => { config.mode = mode.value; persist(); render(); });
    options.append(note, mode, content);
    wrap.append(enabledLabel, options);
    render();
    return wrap;
}

function labeledControl(text, control) {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex; flex-direction:column; gap:3px; flex:1; min-width:110px;';
    const caption = document.createElement('small');
    caption.textContent = text;
    label.append(caption, control);
    return label;
}

function renderGuided(content, config, persist) {
    const guidance = document.createElement('textarea');
    guidance.className = 'text_pole col-rewards-guidance';
    guidance.rows = 3;
    guidance.value = config.guidance;
    guidance.placeholder = 'Choose a new reward appropriate to this character and the story.';
    guidance.addEventListener('input', () => { config.guidance = guidance.value; persist(); });
    const interval = document.createElement('input');
    interval.className = 'text_pole col-rewards-interval';
    interval.type = 'number';
    interval.min = '1';
    interval.step = '1';
    interval.value = config.interval;
    interval.addEventListener('input', () => {
        const valid = Number.isSafeInteger(Number(interval.value)) && Number(interval.value) > 0;
        interval.setCustomValidity(valid ? '' : 'Enter a positive whole number.');
        interval.setAttribute('aria-invalid', String(!valid));
        if (valid) { config.interval = Number(interval.value); persist(); }
    });
    const note = document.createElement('small');
    note.className = 'notes';
    note.textContent = 'One suitable new entry per eligible level, using the fields below. Every 2 levels means levels 2, 4, 6… The reader may return no reward when none is suitable.';
    content.append(labeledControl('Reward guidance (optional)', guidance), labeledControl('Every N levels', interval), note);
}

function renderSchedule(content, collection, config, persist) {
    const rows = document.createElement('div');
    const renderRows = () => {
        rows.replaceChildren();
        config.schedule.forEach((reward, index) => rows.append(scheduleRow(collection, reward, () => {
            config.schedule.splice(index, 1); persist(); renderRows();
        }, persist)));
    };
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'menu_button col-rewards-add';
    add.textContent = 'Add scheduled reward';
    add.addEventListener('click', () => {
        config.schedule.push({ id: `reward-${crypto.randomUUID()}`, level: 2, entry: {} });
        persist(); renderRows();
    });
    const note = document.createElement('small');
    note.className = 'notes';
    note.textContent = 'Every valid entry is proposed when its required level is crossed. An empty schedule grants nothing. Existing identifiers are skipped, without adding quantities.';
    content.append(note, rows, add);
    renderRows();
}

function scheduleRow(collection, reward, remove, persist) {
    const row = document.createElement('div');
    row.className = 'col-reward-row';
    row.style.cssText = 'padding:8px; margin:8px 0; border:1px solid var(--sillynpc-border); border-radius:6px;';
    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex; flex-wrap:wrap; align-items:end; gap:8px;';
    const level = document.createElement('input');
    level.type = 'number';
    level.className = 'text_pole col-reward-level';
    level.min = '1';
    level.step = '1';
    level.value = reward.level || '';
    const errors = document.createElement('small');
    errors.className = 'col-reward-errors';
    errors.setAttribute('role', 'status');
    const check = () => {
        const messages = validateRewardEntry(collection, reward.entry).errors;
        const validLevel = Number.isSafeInteger(reward.level) && reward.level > 0;
        if (!validLevel) messages.unshift('Required level must be a positive whole number.');
        level.setCustomValidity(validLevel ? '' : messages[0]);
        level.setAttribute('aria-invalid', String(!validLevel));
        errors.textContent = messages.join(' ');
        errors.style.color = messages.length ? 'var(--sillynpc-danger)' : '';
    };
    level.addEventListener('input', () => { reward.level = Number(level.value); persist(); check(); });
    controls.append(labeledControl('Required level', level));
    for (const field of (collection.fields || []).filter(field => !field.retired && !field.locked)) {
        const key = field.id || field.name;
        let input;
        if (field.type === 'boolean' || field.options?.length) {
            input = document.createElement('select');
            input.add(new Option('Use default', ''));
            const values = field.type === 'boolean' ? ['true', 'false'] : field.options;
            for (const value of values) input.add(new Option(String(value), String(value)));
        } else {
            input = document.createElement(field.isMultiline && field.type === 'text' ? 'textarea' : 'input');
            if (input.tagName === 'INPUT') input.type = field.type === 'number' ? 'number' : 'text';
            else input.rows = 2;
            if (field.type === 'number') {
                input.step = 'any';
                if (field.min !== undefined && field.min !== '') input.min = field.min;
                if (field.maxStatValue !== undefined && field.maxStatValue !== '') input.max = field.maxStatValue;
            }
        }
        input.className = 'text_pole col-reward-field';
        input.dataset.fieldId = key;
        input.value = reward.entry[key] ?? '';
        input.placeholder = String(field.defaultValue ?? '');
        input.addEventListener('input', () => {
            if (input.value === '') delete reward.entry[key];
            else reward.entry[key] = field.type === 'number' ? Number(input.value)
                : field.type === 'boolean' ? input.value === 'true' : input.value;
            persist(); check();
        });
        controls.append(labeledControl(`${field.label || field.name}${field.isPrimary ? ' (identifier)' : ''}`, input));
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu_button col-reward-remove';
    button.textContent = 'Remove reward';
    button.addEventListener('click', remove);
    controls.append(button);
    row.append(controls, errors);
    check();
    return row;
}
