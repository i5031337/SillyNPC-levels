import { getSettings, saveSettings } from '../../core/settings.js';
import { buildSettingSlider, buildSettingSelect } from '../shared/ui-shared.js';

export function buildTimeRulesSection(onChange) {
    const settings = getSettings().statusTracker;
    const section = document.createElement('div');

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.style.marginTop = '20px';
    title.textContent = 'Time Rules';
    section.appendChild(title);

    const note = document.createElement('small');
    note.className = 'notes';
    note.style.cssText = 'display:block; margin-bottom:10px;';
    note.textContent = 'What the passing of time changes on its own. Worked out from the '
        + 'clock in your world stats, so the result is exact and identical on a re-roll. '
        + 'These apply without asking, and appear in the message’s change record like '
        + 'anything else, so you can see and undo them.';
    section.appendChild(note);

    const globalNames = (settings.globalStats || []).map(s => s.name).filter(Boolean);
    section.append(buildSettingSelect({
        key: 'statusTracker.clockStat',
        label: 'Clock',
        options: globalNames.length
            ? globalNames.map(n => ({ value: n, label: n }))
            : [{ value: 'Time', label: 'Time' }],
        help: 'Which world stat holds the time. Values like "14 January 2012, 05:30 AM", '
            + '"Day 3, 14:20" or "06:15" are read; anything vaguer, such as "Morning", '
            + 'simply means no measurable time passed and nothing is applied.',
        onChange
    }));

    section.append(buildSettingSlider({
        key: 'statusTracker.clockMaxElapsedMinutes',
        advanced: true,
        label: 'Maximum Time Per Message',
        suffix: ' min',
        min: 60,
        max: 10080,
        step: 60,
        help: 'Ceiling in minutes on what a single message can be worth. A mistyped year '
            + 'or a sudden time skip would otherwise refill or drain everything at once. '
            + 'The default of 1440 is a full day; when the limit bites it is named in the '
            + 'change record rather than hidden.',
        onChange
    }));

    const list = document.createElement('div');
    list.className = 'sillynpc-time-rules';
    section.appendChild(list);

    const redraw = () => {
        list.innerHTML = '';
        const rules = settings.timeRules || [];
        if (!rules.length) {
            const empty = document.createElement('p');
            empty.className = 'notes';
            empty.style.opacity = '0.6';
            empty.textContent = 'No time rules yet.';
            list.appendChild(empty);
        }
        rules.forEach((rule, index) => list.appendChild(buildTimeRuleRow(rule, index, redraw, onChange)));
    };
    redraw();

    const addWrap = document.createElement('div');
    addWrap.className = 'sillynpc-setting';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'menu_button';
    add.innerHTML = '<i class="fa-solid fa-plus"></i> Add Time Rule';
    add.addEventListener('click', () => {
        if (!Array.isArray(settings.timeRules)) settings.timeRules = [];
        settings.timeRules.push({
            id: `rule-${Date.now().toString(36)}`,
            enabled: true,
            scope: 'player',
            stat: (settings.playerStats || [])[0]?.name || '',
            amount: 1,
            perMinutes: 60,
            conditionStat: '',
            conditionValue: '',
        });
        saveSettings();
        redraw();
        onChange?.();
    });
    addWrap.appendChild(add);
    section.appendChild(addWrap);

    return section;
}

/** Which stat list a rule's scope draws from. */
function statNamesForScope(scope) {
    const settings = getSettings().statusTracker;
    const list = scope === 'global' ? settings.globalStats
        : scope === 'characters' ? settings.npcStats
            : settings.playerStats;
    return (list || []).map(s => s.name).filter(Boolean);
}

function buildTimeRuleRow(rule, index, redraw, onChange) {
    const settings = getSettings().statusTracker;
    const row = document.createElement('div');
    row.className = 'sillynpc-time-rule';

    const commit = () => { saveSettings(); onChange?.(); };

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = rule.enabled !== false;
    enabled.title = 'Apply this rule';
    enabled.addEventListener('change', () => { rule.enabled = enabled.checked; commit(); });

    const scope = document.createElement('select');
    scope.className = 'text_pole';
    for (const [value, label] of [['player', 'Player'], ['characters', 'Characters'], ['global', 'World']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = (rule.scope || 'player') === value;
        scope.appendChild(option);
    }
    scope.title = 'Who the rule applies to. Characters means everyone currently in the scene.';
    scope.addEventListener('change', () => {
        rule.scope = scope.value;
        // The old stat almost certainly does not exist on the new scope's list.
        rule.stat = statNamesForScope(rule.scope)[0] || '';
        commit();
        redraw();
    });

    const stat = document.createElement('select');
    stat.className = 'text_pole';
    const names = statNamesForScope(rule.scope || 'player');
    for (const name of names) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        option.selected = rule.stat === name;
        stat.appendChild(option);
    }
    if (!names.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '(no stats configured)';
        stat.appendChild(option);
    }
    stat.addEventListener('change', () => { rule.stat = stat.value; commit(); });

    const amount = document.createElement('input');
    amount.type = 'number';
    amount.className = 'text_pole';
    amount.style.width = '70px';
    amount.value = rule.amount ?? 1;
    amount.title = 'How much each interval is worth. A negative number drains instead, '
        + 'which is how hunger, fatigue or a burning torch are written.';
    amount.addEventListener('input', () => { rule.amount = Number(amount.value); commit(); });

    const per = document.createElement('input');
    per.type = 'number';
    per.className = 'text_pole';
    per.style.width = '80px';
    per.min = '1';
    per.value = rule.perMinutes ?? 60;
    per.title = 'The interval, in minutes. Time left over is carried, so a rule set to '
        + 'every 10 minutes is not lost by messages that only advance the clock by seven.';
    per.addEventListener('input', () => { rule.perMinutes = Number(per.value); commit(); });

    const conditionStat = document.createElement('input');
    conditionStat.type = 'text';
    conditionStat.className = 'text_pole';
    conditionStat.style.width = '120px';
    conditionStat.placeholder = 'always';
    conditionStat.value = rule.conditionStat || '';
    conditionStat.title = 'Optional gate. Name a stat - the character’s own, or a world '
        + 'stat - and the rule only applies while it matches the value beside it. Leave '
        + 'empty for a rule that always applies.';
    conditionStat.addEventListener('input', () => { rule.conditionStat = conditionStat.value; commit(); });

    const conditionValue = document.createElement('input');
    conditionValue.type = 'text';
    conditionValue.className = 'text_pole';
    conditionValue.style.width = '120px';
    conditionValue.placeholder = 'value';
    conditionValue.value = rule.conditionValue || '';
    conditionValue.title = 'Matched loosely: "Resting" also matches "Resting (light sleep)", '
        + 'and case is ignored.';
    conditionValue.addEventListener('input', () => { rule.conditionValue = conditionValue.value; commit(); });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'menu_button delete-btn';
    remove.innerHTML = '<i class="fa-solid fa-trash"></i>';
    remove.title = 'Delete this rule';
    remove.addEventListener('click', () => {
        settings.timeRules.splice(index, 1);
        commit();
        redraw();
    });

    const label = (text) => {
        const el = document.createElement('small');
        el.className = 'sillynpc-time-rule-label';
        el.textContent = text;
        return el;
    };

    row.append(enabled, scope, stat, label('by'), amount, label('every'), per,
        label('min, while'), conditionStat, label('is'), conditionValue, remove);
    return row;
}
