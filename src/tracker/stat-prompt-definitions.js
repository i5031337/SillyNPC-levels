import { progressionFields } from './progression-fields.js';
import { isPoolStat } from './numeric-stat-bounds.js';

/** The same configured stat rules for separate-reader and inline tracking. */
export function describeStatDefinitions(settings) {
    const lines = [];
    for (const [scope, stats] of [
        ['World', settings.globalStats], ['Player', settings.playerStats], ['NPC', settings.npcStats],
    ]) {
        for (const stat of stats || []) {
            if (!stat?.name) continue;
            const numeric = stat.type === 'number' || stat.type === 'bar';
            const pool = isPoolStat(stat);
            const config = scope === 'Player' ? progressionFields(settings, { isPlayer: true }) : {};
            const progression = config.enabled && stat.name === config.xpName ? 'xp'
                : config.enabled && stat.name === config.levelName ? 'level' : '';
            const parts = [numeric ? (pool ? 'numeric pool' : 'numeric rating') : 'text'];
            if (String(stat.purpose ?? '').trim()) parts.push(`purpose: ${stat.purpose.trim()}`);
            if (numeric) {
                if (String(stat.min ?? '').trim()) parts.push(`minimum current value ${stat.min}`);
                const startMax = String(stat.maxStatValue ?? '').trim()
                    || String(stat.defaultValue ?? '').match(/^\s*-?\d+(?:\.\d+)?\s*\/\s*(-?\d+(?:\.\d+)?)\s*$/)?.[1];
                if (progression === 'level') {
                    parts.push('XP progression counter; initialize a blank NPC Level once, then only the level-up system raises it');
                } else if (progression === 'xp') {
                    if (startMax) parts.push(`XP threshold ${startMax}`);
                    parts.push('threshold stays fixed; report earned XP as a positive delta');
                } else if (pool) {
                    if (startMax) parts.push(`starting maximum ${startMax} (also bounds plain numeric readings)`);
                    parts.push("initialize new NPC pools with their own current/maximum; a bare initial number means current/current; maximum stays fixed during ordinary updates; only configured level growth may raise it");
                    if (String(stat.maxStatValue ?? '').trim()) parts.push(`level growth capacity limit ${stat.maxStatValue}`);
                } else {
                    if (startMax) parts.push(`fixed maximum ${startMax}`);
                    parts.push('fixed bound; configured level growth may increase the rating');
                }
            } else {
                if ((stat.options || []).length) parts.push(`allowed values: ${stat.options.join(', ')}`);
                if (String(stat.hint ?? '').trim()) parts.push(`write it: ${stat.hint.trim()}`);
                if (Number(stat.maxLength) > 0) parts.push(`at most ${stat.maxLength} characters`);
            }
            if (progression === 'level bonus') parts.push('written by the level-up system');
            if (stat.locked) parts.push('reader cannot change after initialization; configured level growth and direct edits remain allowed');
            lines.push(`- ${scope}.${stat.name}: ${parts.join('; ')}`);
        }
    }
    const templates = settings.npcTemplates || [];
    for (const template of templates) {
        const config = progressionFields(settings, { actor: { npcTemplateId: template.id } });
        if (config.enabled) lines.push(`- NPC template ${template.id}: report earned ${config.xpName} as positive deltas; ${config.levelName} may be initialized once while blank, then is reserved for automatic progression. Never award existing NPC levels or growth directly.`);
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
            if (!stat?.name || (!initializeNpc && stat.locked)) continue;
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
