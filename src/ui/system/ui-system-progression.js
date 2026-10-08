import { normalizeSystemDefinition } from '../../core/system-schema.js';
import { liveSystemContext } from './ui-system-context.js';
import { normalizeProgressionConfig, progressionStatEligible, normalizeTrackerProgression } from '../../core/progression-config.js';

/** Shared player/template progression controls. */
export function buildProgressionEditor({ template, onRefresh = () => {}, context = liveSystemContext, onSave = context.saveSettings } = {}) {
    const { getSettings } = context;
    const tracker = getSettings().statusTracker;
    const stats = template ? tracker.npcStats || [] : tracker.playerStats || [];
    const normalized = normalizeSystemDefinition({ statusTracker: tracker });
    const normalizedStats = template ? normalized.stats.npc : normalized.stats.player;
    stats.forEach((stat, index) => { stat.id ||= normalizedStats[index].id; });
    tracker.progression ||= {};
    const owner = template || tracker.progression;
    const key = template ? 'progression' : 'player';
    const config = normalizeProgressionConfig(owner[key], stats,
        { enabledByDefault: !template, ...(template ? { statIds: template.statIds } : {}) });
    owner[key] = config;
    const wrap = document.createElement('fieldset');
    wrap.className = 'sillynpc-progression-editor';
    const legend = document.createElement('legend'); legend.textContent = 'Level progression'; wrap.append(legend);
    const save = () => { owner[key] = config; normalizeTrackerProgression(tracker, context.definition()); onSave(); onRefresh(); };
    const enableLabel = document.createElement('label');
    const enable = document.createElement('input'); enable.type = 'checkbox'; enable.checked = config.enabled;
    enable.setAttribute('aria-label', 'Enable level progression');
    enable.addEventListener('change', () => { config.enabled = enable.checked;
        if (template && config.enabled) template.statIds = [...new Set([...template.statIds, config.xpFieldId, config.levelFieldId].filter(Boolean))];
        save(); });
    enableLabel.append(enable, ' Enable level progression'); wrap.append(enableLabel);
    const controls = document.createElement('div'); wrap.append(controls);
    const select = (labelText, key, options) => {
        const label = document.createElement('label'); label.style.display = 'block'; label.textContent = `${labelText} `;
        const input = document.createElement('select'); input.className = 'text_pole'; input.setAttribute('aria-label', labelText);
        for (const [value, title] of options) { const opt = document.createElement('option'); opt.value = value; opt.textContent = title; input.append(opt); }
        input.value = config[key]; input.addEventListener('change', () => {
            config[key] = input.value;
            if (template && ['xpFieldId', 'levelFieldId'].includes(key)) template.statIds = [...new Set([...template.statIds, input.value])];
            save();
        }); label.append(input); controls.append(label);
    };
    const options = [['', 'Choose field'], ...stats.filter(stat => !stat.retired && (stat.type === 'number' || /^\d/.test(String(stat.defaultValue))))
        .map(stat => [stat.id, stat.name])];
    select('XP field', 'xpFieldId', options); select('Level field', 'levelFieldId', options);
    if (!config.enabled) return wrap;
    const pointsLabel = document.createElement('label'); pointsLabel.style.display = 'block';
    pointsLabel.textContent = 'Skill points per level ';
    const points = document.createElement('input'); points.type = 'number'; points.min = '0'; points.step = '1';
    points.className = 'text_pole'; points.value = config.pointsPerLevel;
    points.setAttribute('aria-label', 'Skill points per level');
    points.addEventListener('change', () => {
        const value = Number(points.value);
        if (!points.value.trim() || !Number.isSafeInteger(value) || value < 0) { points.value = config.pointsPerLevel; return; }
        config.pointsPerLevel = value; save();
    });
    pointsLabel.append(points); controls.append(pointsLabel);
    select('Point assignment', 'assignment', [['random', 'Random'], ['manual', 'Manual']]);
    const help = document.createElement('p');
    help.textContent = 'Each point increases one selected stat by 1. Pools gain current value and capacity; ratings stay within their caps. Random picks independently for each point, so a stat can receive several points. Set points to 0 to disable numeric growth.';
    controls.append(help);
    for (const stat of stats.filter(stat => progressionStatEligible(stat, config)
        && (!template || template.statIds.includes(stat.id)))) {
        const label = document.createElement('label'); label.style.display = 'block';
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = config.statIds.includes(stat.id);
        check.setAttribute('aria-label', `${stat.name} level growth`);
        check.addEventListener('change', () => {
            config.statIds = check.checked ? [...new Set([...config.statIds, stat.id])] : config.statIds.filter(id => id !== stat.id);
            save();
        }); label.append(check, ` ${stat.name}`);
        controls.append(label);
    }
    return wrap;
}
