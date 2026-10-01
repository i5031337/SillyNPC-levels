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
            const progression = scope === 'Player' ? stat.name.toLowerCase() : '';
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
                    if (startMax) parts.push(`initialization maximum ${startMax} (blank stats only)`);
                    parts.push("maximum stays fixed during ordinary updates; only a level bonus may raise it");
                } else {
                    if (startMax) parts.push(`fixed maximum ${startMax}`);
                    parts.push('maximum never increases; rating changes only by level-up bonus or direct edit');
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
    return lines.join('\n');
}
