import { getSettings, saveSettings } from '../../core/settings.js';
import { activeNpcSystem } from '../../core/npc-templates.js';
import { normalizeSystemDefinition } from '../../core/system-schema.js';

/** Give the live NPC stat catalog stable IDs before templates reference it. */
export function ensureNpcStatIds() {
    const settings = getSettings();
    const system = activeNpcSystem(settings);
    if (!system) return;
    const stats = settings.statusTracker.npcStats || [];
    const normalized = normalizeSystemDefinition({ ...system, stats: { ...system.stats, npc: stats } });
    stats.forEach((stat, index) => { stat.id = normalized.stats.npc[index].id; });
    system.stats.npc = normalized.stats.npc;
}

function input(tag, value, label, change) {
    const element = document.createElement(tag);
    element.className = 'text_pole';
    element.value = value;
    element.placeholder = label;
    element.setAttribute('aria-label', label);
    element.addEventListener('change', () => { change(element.value); saveSettings(); });
    return element;
}

function choices(title, fields, selected, key, template) {
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = title;
    group.append(legend);
    for (const field of fields.filter(field => !field.retired)) {
        const label = document.createElement('label');
        label.style.display = 'block';
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = selected.includes(field.id);
        check.addEventListener('change', () => {
            template[key] = check.checked ? [...new Set([...template[key], field.id])]
                : template[key].filter(id => id !== field.id);
            saveSettings();
        });
        label.append(check, ` ${field.label || field.name}`);
        group.append(label);
    }
    return group;
}

export function buildNpcTemplatesEditor(onRefresh) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-npc-templates';
    const system = activeNpcSystem(getSettings());
    if (!system) { wrap.textContent = 'Select a System to define NPC templates.'; return wrap; }
    ensureNpcStatIds();
    const help = document.createElement('p');
    help.textContent = 'Define reusable NPC types. The reader assigns new NPCs using the description. Select their fields from NPC Stats and NPC Profile; each character keeps its own values.';
    wrap.append(help);
    for (const template of system.npcTemplates) {
        const section = document.createElement('details');
        section.open = true;
        section.className = 'sillynpc-system-profile-row';
        const title = document.createElement('summary');
        title.textContent = template.name;
        const name = input('input', template.name, 'Template name', value => {
            if (value.trim()) template.name = value.trim();
            title.textContent = template.name;
        });
        const description = input('textarea', template.description, 'Which NPCs belong to this template?', value => { template.description = value.trim(); });
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
            if (system.legacyNpcTemplateId === template.id) delete system.legacyNpcTemplateId;
            saveSettings(); onRefresh();
        });
        section.append(title, name, id, description,
            choices('Profile fields', system.profiles.npc, template.profileIds, 'profileIds', template),
            choices('Stats', getSettings().statusTracker.npcStats, template.statIds, 'statIds', template), remove);
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
        system.npcTemplates.push({ id, name: name.value.trim(), description: '', profileIds: [], statIds: [] });
        saveSettings(); onRefresh();
    });
    wrap.append(name, add);
    return wrap;
}
