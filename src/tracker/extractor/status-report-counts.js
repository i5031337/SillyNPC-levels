import { isPoolStat } from '../numeric-stat-bounds.js';

const categories = {
    xp: ['XP update', 'XP updates'],
    levelUp: ['level-up', 'level-ups'],
    level: ['level change', 'level changes'],
    stat: ['stat', 'stats'],
    'item-add': ['item added', 'items added'],
    'item-remove': ['item removed', 'items removed'],
    'item-change': ['item field', 'item fields'],
    'npc-template': ['NPC template', 'NPC templates'],
    'memory-add': ['memory', 'memories'],
    reward: ['level reward change', 'level reward changes'],
    other: ['other change', 'other changes'],
};

function category(row) {
    if (row.grant || row.kind === 'stat-points') return 'reward';
    if (row.kind === 'stat') {
        const label = String(row.label || '').toLowerCase();
        if ((row.transition?.xpName && row.label === row.transition.xpName) || label === 'xp') return 'xp';
        if ((row.transition?.levelName && row.label === row.transition.levelName) || label === 'level') {
            return Number(row.after) > Number(row.before) ? 'levelUp' : 'level';
        }
    }
    return categories[row.kind] ? row.kind : 'other';
}

function count(rows) {
    const counts = new Map();
    for (const row of rows) {
        const key = category(row);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

function describe(counts) {
    return Object.entries(categories).filter(([key]) => counts.has(key))
        .map(([key, labels]) => `${counts.get(key)} ${labels[counts.get(key) === 1 ? 0 : 1]}`)
        .join(', ') || 'None';
}

function describeRows(rows) {
    const levels = rows.filter(row => ['levelUp', 'level'].includes(category(row)))
        .map(row => `${row.label}: ${row.before} → ${row.after}`);
    const details = [...levels, ...rows.map(row => row.maximumDetail).filter(Boolean)];
    return describe(count(rows)) + (details.length ? ` (${details.join(', ')})` : '');
}

/** A stat's value and pool maximum are one reported change, retaining the review rows. */
function reportRows(rows, statDefinition) {
    const result = rows.filter(row => row.kind !== 'stat-max').map(row => ({ ...row }));
    for (const maximum of rows.filter(row => row.kind === 'stat-max')) {
        const def = statDefinition(maximum);
        if (!isPoolStat(def)) continue;
        const paired = result.find(row => row.kind === 'stat' && row.scope === maximum.scope
            && row.actor === maximum.actor && row.label === maximum.label
            && row.grant?.id === maximum.grant?.id);
        const detail = `${maximum.label} maximum: `
            + (maximum.before && maximum.before !== '(none)' ? `${maximum.before} → ` : '') + maximum.after;
        if (paired) paired.maximumDetail = detail;
        else result.push({ ...maximum, kind: 'stat', maximumDetail: detail });
    }
    return result;
}

/** Summarize visible changes; accepted memories have no tracker-state rows. */
export function buildReportBreakdown(applied = [], pending = [], reviewedMemories = 0, statDefinition = () => null) {
    applied = reportRows(applied, statDefinition);
    pending = reportRows(pending, statDefinition);
    const appliedCounts = count(applied);
    if (reviewedMemories) appliedCounts.set('memory-add', (appliedCounts.get('memory-add') || 0) + reviewedMemories);
    const groups = new Map();
    for (const [status, rows] of [['applied', applied], ['pending', pending]]) {
        for (const row of rows) {
            const target = row.scope === 'player' ? 'Player' : row.scope === 'global' ? 'World'
                : row.scope === 'character' ? `NPC: ${row.actor || 'Unknown'}` : 'Other';
            if (!groups.has(target)) groups.set(target, { target, applied: [], pending: [] });
            groups.get(target)[status].push(row);
        }
    }
    const rows = [...groups.values()].map(group => ({ target: group.target,
        applied: describeRows(group.applied), pending: describeRows(group.pending) }));
    // Accepted memories have a total but no per-character applied record.
    if (reviewedMemories) rows.push({ target: 'Reviewed memories',
        applied: `${reviewedMemories} ${reviewedMemories === 1 ? 'memory' : 'memories'}`, pending: 'None' });
    return { applied: describe(appliedCounts), pending: describe(count(pending)), rows };
}
