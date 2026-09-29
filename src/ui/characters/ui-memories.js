import { appendMemory, editMemory, memoryLimit, normalizeMemoryStore, removeMemory } from '../../core/profile-memories.js';

function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Draw active and archived story memories with their source and manual corrections. */
export function renderMemorySection(container, { read, write, fields = [], limit = 50 }) {
    if (!container) return;
    const labels = new Map(fields.map(field => [field.id, field.label]));
    const memoryFields = fields.filter(field => field.policy === 'memory');
    const section = element('section', 'sillynpc-memory-section');
    container.append(section);

    function draw() {
        const store = normalizeMemoryStore(read(), 500);
        section.replaceChildren(element('h3', '', 'Memories'));

        if (memoryFields.length) {
            const form = element('div', 'sillynpc-memory-add');
            const input = element('textarea', 'text_pole sillynpc-memory-text');
            input.rows = 2;
            input.placeholder = 'Add a memory';
            input.setAttribute('aria-label', 'New memory');
            let fieldSelect;
            if (memoryFields.length > 1) {
                fieldSelect = element('select', 'text_pole');
                fieldSelect.setAttribute('aria-label', 'Memory field');
                for (const field of memoryFields) {
                    const option = element('option', '', field.label);
                    option.value = field.id;
                    fieldSelect.append(option);
                }
                fieldSelect.value = memoryFields[0].id;
                form.append(fieldSelect);
            }
            const add = element('button', 'menu_button', 'Add memory');
            add.type = 'button';
            add.addEventListener('click', () => {
                const fieldId = fieldSelect?.value || memoryFields[0].id;
                const result = appendMemory(read(), { text: input.value, fieldId, manual: true },
                    memoryLimit(limit));
                if (!result.added) return;
                write(result.store);
                draw();
            });
            form.append(input, add);
            section.append(form);
        }

        for (const [kind, entries] of [['Active', store.entries], ['Archived', store.archive]]) {
            const group = element('div', 'sillynpc-memory-group');
            group.append(element('div', 'sillynpc-cv-label', `${kind} · ${entries.length}`));
            if (!entries.length) group.append(element('p', 'notes', kind === 'Active'
                ? 'No memories recorded yet.' : 'No archived memories.'));
            for (const entry of entries) {
                const row = element('div', 'sillynpc-memory-row');
                const input = element('textarea', 'text_pole sillynpc-memory-text');
                input.rows = 2;
                input.value = entry.text;
                input.setAttribute('aria-label', `Edit ${kind.toLowerCase()} memory`);
                const source = entry.manual ? 'Manually added'
                    : `Message ${entry.sourceMessageId}`;
                const label = labels.get(entry.fieldId) || entry.fieldId;
                const meta = element('small', 'notes', `${label ? `${label} · ` : ''}${source}`
                    + (entry.editedManually ? ' · corrected' : ''));
                const controls = element('div', 'sillynpc-memory-controls');
                const save = element('button', 'menu_button', 'Save');
                save.type = 'button';
                save.addEventListener('click', () => {
                    const next = editMemory(read(), entry.id, input.value);
                    write(next);
                    draw();
                });
                const remove = element('button', 'menu_button', 'Remove');
                remove.type = 'button';
                remove.setAttribute('aria-label', `Remove ${kind.toLowerCase()} memory`);
                remove.addEventListener('click', () => {
                    write(removeMemory(read(), entry.id));
                    draw();
                });
                controls.append(save, remove);
                row.append(input, meta, controls);
                group.append(row);
            }
            section.append(group);
        }
    }
    draw();
    return section;
}
