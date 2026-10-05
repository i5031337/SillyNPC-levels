import { progressionFields } from './progression-fields.js';
import { isTurnStat } from './stat-update-policy.js';

/** The same configured stat rules for separate-reader and inline tracking. */
export function describeStatDefinitions(settings) {
    const lines = [];
    for (const [scope, stats] of [
        ['World', settings.globalStats], ['Player', settings.playerStats], ['NPC', settings.npcStats],
    ]) {
        for (const stat of stats || []) {
            if (!stat?.name) continue;
            const numeric = stat.type === 'number' || stat.type === 'bar';
            const turn = isTurnStat(stat);
            const config = scope === 'Player' ? progressionFields(settings, { isPlayer: true }) : {};
            const progression = config.enabled && stat.name === config.xpName ? 'xp'
                : config.enabled && stat.name === config.levelName ? 'level' : '';
            const parts = [numeric ? 'number' : 'text', turn ? 'Turn' : 'Advancement'];
            if (String(stat.purpose ?? '').trim()) parts.push(`purpose: ${stat.purpose.trim()}`);
            if (numeric) {
                if (String(stat.min ?? '').trim()) parts.push(`minimum current value ${stat.min}`);
                const startMax = String(stat.maxStatValue ?? '').trim()
                    || String(stat.defaultValue ?? '').match(/^\s*-?\d+(?:\.\d+)?\s*\/\s*(-?\d+(?:\.\d+)?)\s*$/)?.[1];
                if (progression === 'level') {
                    parts.push('XP progression counter; raised by the level-up system');
                } else if (progression === 'xp') {
                    if (startMax) parts.push(`XP threshold ${startMax}`);
                    parts.push('threshold stays fixed; report earned XP as a positive delta');
                } else if (turn) {
                    if (startMax) parts.push(`starting maximum ${startMax} (also bounds plain numeric readings)`);
                    parts.push("maximum stays fixed during ordinary updates; only configured level growth may raise it");
                    if (String(stat.maxStatValue ?? '').trim()) parts.push(`level growth capacity limit ${stat.maxStatValue}`);
                } else {
                    if (startMax) parts.push(`fixed maximum ${startMax}`);
                    parts.push('maximum never increases; rating changes only by level growth or direct edit');
                }
            } else {
                if ((stat.options || []).length) parts.push(`allowed values: ${stat.options.join(', ')}`);
                if (String(stat.hint ?? '').trim()) parts.push(`write it: ${stat.hint.trim()}`);
                if (Number(stat.maxLength) > 0) parts.push(`at most ${stat.maxLength} characters`);
            }
            if (progression === 'level bonus') parts.push('written by the level-up system');
            if (stat.locked) parts.push('immutable after initialization');
            lines.push(`- ${scope}.${stat.name}: ${parts.join('; ')}`);
        }
    }
    const templates = settings.npcTemplates || [];
    for (const template of templates) {
        const config = progressionFields(settings, { actor: { npcTemplateId: template.id } });
        if (config.enabled) lines.push(`- NPC template ${template.id}: report earned ${config.xpName} as positive deltas; ${config.levelName} is reserved for automatic progression. Never award levels or growth directly.`);
    }
    return lines.join('\n');
}

/** Reader instructions describe writable fields; enforcement belongs to the tracker. */
export function describeReaderStats(settings, { initializeNpc = false } = {}) {
    const scopes = initializeNpc ? [['NPC', settings.npcStats]] : [
        ['World', settings.globalStats], ['Player', settings.playerStats], ['NPC', settings.npcStats],
    ];
    const lines = [];
    for (const [scope, stats] of scopes) {
        for (const stat of stats || []) {
            if (!stat?.name || !isTurnStat(stat) || (!initializeNpc && stat.locked)) continue;
            const config = scope === 'Player' ? progressionFields(settings, { isPlayer: true }) : {};
            if (scope === 'Player' && (stat.name === config.levelName || stat.name.toLowerCase() === 'level bonus')) continue;
            const numeric = stat.type === 'number' || stat.type === 'bar';
            const parts = [numeric ? 'number' : 'text'];
            if (String(stat.purpose ?? '').trim()) parts.push(stat.purpose.trim());
            if (!numeric) {
                if (stat.options?.length) parts.push(`choose: ${stat.options.join(', ')}`);
                if (String(stat.hint ?? '').trim()) parts.push(stat.hint.trim());
                if (Number(stat.maxLength) > 0) parts.push(`up to ${stat.maxLength} characters`);
            }
            if (initializeNpc) {
                if (String(stat.defaultValue ?? '').trim()) parts.push(`default: ${stat.defaultValue}`);
                if (numeric) {
                    if (String(stat.min ?? '').trim()) parts.push(`min: ${stat.min}`);
                    if (String(stat.maxStatValue ?? '').trim()) parts.push(`max: ${stat.maxStatValue}`);
                }
            }
            lines.push(`- ${scope}.${stat.name}: ${parts.join('; ')}`);
        }
    }
    return lines.join('\n');
}
