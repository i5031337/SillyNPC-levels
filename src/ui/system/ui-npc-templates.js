import { buildProgressionEditor } from './ui-system-progression.js';
import { liveSystemContext, saveSystemEditor } from './ui-system-context.js';
import { systemStatFields, systemProfileFields } from '../../core/system-fields.js';
import { normalizeProgressionConfig } from '../../core/progression-config.js';

// Keep disclosure state in the editor context, separate from saved System data.
const disclosureStates = new WeakMap();

function input(tag, value, label, change, saveSettings) {
    const element = document.createElement(tag);
    element.className = 'text_pole';
    element.value = value;
    element.placeholder = label;
    element.setAttribute('aria-label', label);
    element.addEventListener('change', () => { change(element.value); saveSettings(); });
    return element;
}

export function buildNpcTemplatesEditor(onRefresh, context = liveSystemContext) {
    const { getSettings } = context;
    const saveSettings = () => saveSystemEditor(context);
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-npc-templates';
    const system = context.definition();
    if (!system) { wrap.textContent = 'Select a System to define NPC templates.'; return wrap; }
    if (!disclosureStates.has(context)) disclosureStates.set(context, new Map());
    const systems = disclosureStates.get(context);
    const systemKey = getSettings().activeSystem;
    if (!systems.has(systemKey)) systems.set(systemKey, new Map());
    const openStates = systems.get(systemKey);
    const refresh = () => {
        // Capture synchronously: native toggle events can arrive after a checkbox refresh.
        for (const section of wrap.querySelectorAll('details[data-template-id]')) {
            openStates.set(section.dataset.templateId, section.open);
        }
        onRefresh?.();
    };
    getSettings().statusTracker.npcTemplates = system.npcTemplates;
    const help = document.createElement('p');
    help.textContent = 'Define reusable NPC types. The reader assigns new NPCs using the description. Assign shared fields on the Stats and Profile fields pages; each character keeps its own values.';
    wrap.append(help);
    for (const template of system.npcTemplates) {
        const section = document.createElement('details');
        section.open = openStates.get(template.id) ?? true;
        section.dataset.templateId = template.id;
        section.addEventListener('toggle', () => {
            if (section.isConnected) openStates.set(template.id, section.open);
        });
        section.className = 'sillynpc-system-profile-row';
        const title = document.createElement('summary');
        title.textContent = template.name;
        const name = input('input', template.name, 'Template name', value => {
            if (value.trim()) template.name = value.trim();
            title.textContent = template.name;
        }, saveSettings);
        const description = input('textarea', template.description, 'Which NPCs belong to this template?', value => { template.description = value.trim(); }, saveSettings);
        description.rows = 2;
        const id = document.createElement('small');
        id.textContent = `ID: ${template.id}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'menu_button';
        remove.textContent = 'Remove template';
        remove.title = 'Existing character values remain saved. NPCs using this template will need reassignment.';
        remove.addEventListener('click', () => {
            system.npcTemplates = system.npcTemplates.filter(item => item !== template);
            getSettings().statusTracker.npcTemplates = system.npcTemplates;
            if (system.legacyNpcTemplateId === template.id) delete system.legacyNpcTemplateId;
            for (const field of [...system.stats.character, ...system.profiles, ...system.collections, ...(getSettings().statusTracker.collections || [])]) {
                field.targets = (field.targets || []).filter(target => target !== `template:${template.id}`);
            }
            saveSettings(); refresh();
        });
        const fields = document.createElement('p');
        const actor = { npcTemplateId: template.id };
        fields.textContent = `Stats: ${systemStatFields(system, 'npc', actor).map(field => field.name).join(', ') || 'None'}. Profile fields: ${systemProfileFields(system, 'npc', actor).map(field => field.label).join(', ') || 'None'}.`;
        section.append(title, name, id, description, fields,
            buildProgressionEditor({ template, onRefresh: refresh, context }), remove);
        wrap.append(section);
    }
    const name = document.createElement('input');
    name.className = 'text_pole';
    name.placeholder = 'New template name, e.g. Human';
    name.setAttribute('aria-label', 'New NPC template name');
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'menu_button'; add.textContent = 'Add template';
    add.addEventListener('click', () => {
        if (!name.value.trim()) return;
        const used = new Set(system.npcTemplates.map(template => template.id));
        const base = name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'npc';
        const stem = /^[a-z]/.test(base) ? base : `npc-${base}`;
        let id = stem;
        for (let i = 2; used.has(id); i++) id = `${stem}-${i}`;
        system.npcTemplates.push({ id, name: name.value.trim(), description: '',
            progression: normalizeProgressionConfig({}, [], { statIds: [] }) });
        saveSettings(); refresh();
    });
    wrap.append(name, add);
    return wrap;
}
