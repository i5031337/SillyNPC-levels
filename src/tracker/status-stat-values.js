import { progressionFields } from './progression-fields.js';
import { npcStatsFor, proposedNpcTemplate } from '../core/npc-templates.js';
import { getSettings } from '../core/settings.js';
import { splitValue, ceilingFromValue } from '../core/utils.js';
import { configuredNumericMaximum, keepNumericMaximum, isPoolStat } from './numeric-stat-bounds.js';

export function bind(deps) {

/**
 * Merges old and new stat values.
 *
 * A reported value keeps the ceiling the actor already carries: "50/100" updated with a
 * bare 40 is "40/100". A value written by hand does not, because it is the whole value.
 *
 * @param {*} oldVal
 * @param {*} newVal
 * @param {{ verbatim?: boolean }} [options] verbatim means the new value is the whole
 *   value, not a reading of part of one - see rule 2 below.
 */
function mergeStatValue(oldVal, newVal, options = {}) {
    const { verbatim = false } = options;
    if (newVal === undefined || newVal === null) return newVal;
    const strOld = oldVal !== undefined && oldVal !== null ? String(oldVal) : '';
    const strNew = String(newVal);
    
    // 1. The incoming value brought its own. "280/350" states a ceiling outright.
    if (strNew.includes('/')) return clampToCeiling(strNew.trim());

    // Preserve a valid held pool ceiling for reader updates; manual edits replace it.
    const parts = strOld.split('/');
    if (!verbatim && parts.length === 2 && ceilingFromValue(strOld) !== null) {
        return clampToCeiling(`${strNew.trim()}/${parts[1].trim()}`);
    }

    /* And deliberately no third. The configured maximum is a *starting* maximum: it seeds a
       stat the first time an actor is given one, and from then on the value is the only
       thing that carries a pool ceiling. Plain numeric ratings are bounded separately by
       constrainNumericStat without adding a denominator. */
    return clampToCeiling(strNew.trim());
}

/** The configured starting maximum, falling back to the default pool denominator. */
function resolveMaxValue(statDef) {
    if (!statDef) return '';
    const explicit = statDef.maxStatValue;
    if (explicit !== undefined && String(explicit).trim() !== '') return String(explicit).trim();
    const fallback = statDef.defaultValue;
    if (typeof fallback === 'string' && fallback.includes('/')) {
        const denominator = fallback.split('/')[1]?.trim();
        if (denominator) return denominator;
    }
    return '';
}

/**
 * Fields held out of ordinary turn updates, by scope.
 *
 * @returns {{ world: string[], player: string[], characters: string[] }}
 */
function lockedStats(trackerSettings = getSettings().statusTracker) {
    const names = (list) => (list || []).filter(stat => stat?.locked && stat.name).map(stat => stat.name);
    return {
        world: names(trackerSettings.globalStats),
        player: names(trackerSettings.playerStats),
        characters: (trackerSettings.npcStats || [])
            .filter(stat => stat?.name && stat.locked)
            .map(stat => stat.name),
    };
}

/**
 * What a model's reply may not do to the stats, taken out before it is applied.
 *
 * Only for replies from a model - the tracker's reader and the inline block. Your own edits
 * never come through here, so typing "120/150" on the sheet still sets a ceiling.
 *
 * - Blank NPC fields may be initialized, including locked fields and Level.
 *   Configured level growth and direct edits may change locked fields later.
 * - New NPC pools take their individual maximum from the initial reading.
 *   Ordinary reader updates retain the existing maximum;
 *   a configured starting maximum also bounds values saved as plain numbers.
 *
 * @param {object} update Changed in place, and returned.
 * @param {object} state The state the reply is applied to.
 */
function sanitizeModelUpdate(update, state, trackerSettings = getSettings().statusTracker, { warnings = [] } = {}) {
    if (!update || typeof update !== 'object') return update;
    // Model replies never select level-derived stat growth or write narrative bonuses.

    const clean = (stats, defs, stored, { npc = false, player = false, cardStats = {}, progression = {}, owner = 'World' } = {}) => {
        if (!stats || typeof stats !== 'object') return;
        for (const key of Object.keys(stats)) {
            const reject = reason => {
                warnings.push(`${owner} · ${key}: "${String(stats[key])}" skipped: ${reason}.`);
                delete stats[key];
            };
            const fragment = key.replace(/_(?:current|cur|now|value|val|maximum|max|total|cap)$/i, '');
            const levelField = progression.enabled && fragment.toLowerCase() === progression.levelName?.toLowerCase();
            const levelHeld = stored?.[deps.findMatchingStatKey(stored || {}, fragment) || fragment];
            const levelCardHeld = cardStats?.[deps.findMatchingStatKey(cardStats || {}, fragment) || fragment];
            if (levelField && (!npc || key.toLowerCase() !== progression.levelName.toLowerCase()
                || String(levelHeld ?? '').trim() || String(levelCardHeld ?? '').trim())) {
                reject('Level is managed by XP progression'); continue;
            }
            const def = (defs || []).find(d => String(d?.name).toLowerCase() === key.toLowerCase());
            const maxFragment = key.match(/^(.*)_(?:maximum|max|total|cap)$/i);
            if (!def && maxFragment && (defs || []).some(d => d?.name?.toLowerCase() === maxFragment[1].toLowerCase()
                && isNumericStat(d))) {
                reject('the reader cannot change a numeric maximum');
                continue;
            }
            if (!def) continue;
            if (levelField && (!Number.isSafeInteger(Number(stats[key])) || Number(stats[key]) < 1)) {
                reject('initial Level must be a positive whole number'); continue;
            }
            const held = stored?.[deps.findMatchingStatKey(stored || {}, key) || key];
            const cardHeld = cardStats?.[deps.findMatchingStatKey(cardStats || {}, key) || key];
            if (def.locked) {
                // A locked NPC stat may be seeded once, but a value already on its
                // card must also protect it while the character is off stage.
                if (!npc || String(held ?? '').trim() || String(cardHeld ?? '').trim()) {
                    reject('this stat is locked');
                    continue;
                }
            }
            const incoming = String(stats[key] ?? '');
            if (isNumericStat(def)) {
                const storedValue = String(held ?? '').trim() ? held : cardHeld;
                const initializing = npc && !String(held ?? '').trim() && !String(cardHeld ?? '').trim();
                if (initializing && isPoolStat(def) && def.name !== progression.xpName) {
                    // A bare initial pool reading means a full pool of that size.
                    const reading = incoming.trim();
                    stats[key] = /^-?\d+(?:\.\d+)?$/.test(reading) ? `${reading}/${reading}` : incoming;
                    continue;
                }
                const fixedCap = !isPoolStat(def) && !isPoolStat(def, storedValue) ? configuredNumericMaximum(def) : null;
                const plainReading = !isPoolStat(def) && String(storedValue ?? '').trim() && ceilingFromValue(storedValue) === null;
                const liveCap = plainReading ? '' : fixedCap ?? promptCeiling(def, storedValue);
                stats[key] = keepNumericMaximum(incoming, liveCap);
                const requestedCap = incoming.split('/')[1]?.trim();
                if (requestedCap !== undefined && requestedCap !== String(stats[key]).split('/')[1]?.trim()) {
                    warnings.push(`${owner} · ${key}: maximum "${requestedCap}" skipped: the reader keeps the existing maximum (using "${stats[key]}").`);
                }
            }
        }
    };

    clean(update.global, trackerSettings.globalStats, state?.global);
    if (update.player && typeof update.player === 'object') {
        // applyUpdate reads update.player.stats, or update.player itself when it is flat.
        const playerStats = update.player.stats && typeof update.player.stats === 'object'
            ? update.player.stats : update.player;
        clean(playerStats, trackerSettings.playerStats, state?.player?.stats, { player: true, owner: 'Player', progression: progressionFields(trackerSettings, { isPlayer: true }) });
    }
    for (const actor of Array.isArray(update.characters) ? update.characters : []) {
        const current = (state?.characters || [])
            .find(c => String(c?.name).toLowerCase() === String(actor?.name).toLowerCase());
        const selected = proposedNpcTemplate(current?.npcTemplateId ? current : deps.findCardForName(actor?.name), actor);
        clean(actor?.stats && typeof actor.stats === 'object' ? actor.stats : actor,
            npcStatsFor({ npcTemplateId: selected?.id }, trackerSettings), current?.stats,
            { npc: true, owner: actor.name || 'NPC', cardStats: deps.findCardForName(actor?.name)?.statusOverrides,
                progression: progressionFields(trackerSettings, { actor: { npcTemplateId: selected?.id
                    || current?.npcTemplateId || deps.findCardForName(actor?.name)?.npcTemplateId || actor?.npcTemplateId } }) });
    }
    return update;
}

/** The actor's live maximum, or the configured starting maximum without a pool. */
function promptCeiling(statDef, storedValue) {
    const held = storedValue !== undefined && storedValue !== null && String(storedValue).trim() !== '';
    if (!held || ceilingFromValue(storedValue) === null) {
        // The default pool denominator seeds capacity; maxStatValue only limits growth.
        const startingCap = ceilingFromValue(statDef?.defaultValue);
        return startingCap === null ? resolveMaxValue(statDef) : String(startingCap);
    }
    return String(splitValue(storedValue).max).trim();
}

/**
 * The cast's highest ceiling for a stat, returned as the value that carries it.
 *
 * undefined when nobody holds the stat at all. A plain value also lets promptCeiling
 * fall back to the configured maximum.
 *
 * @param {object[]} characters
 * @param {string} name
 */
function highestCeiling(characters, name) {
    let best;
    let bestNum = -Infinity;
    for (const char of characters || []) {
        const value = char?.stats?.[name];
        if (value === undefined || value === null || String(value).trim() === '') continue;
        const ceiling = ceilingFromValue(value);
        if (ceiling === null) {
            if (best === undefined) best = value;
            continue;
        }
        if (ceiling > bestNum) { bestNum = ceiling; best = value; }
    }
    return best;
}

/** Numeric fields also accept the saved 'bar' type before normalization. */
function isNumericStat(statDef) {
    const type = statDef?.type;
    return type === 'number' || type === 'bar';
}

/** The configured NPC fields, included in both tracker prompts for new arrivals. */
function describeNpcStatFields(trackerSettings) {
    return (trackerSettings?.npcStats || [])
        .filter(stat => stat?.name)
        .map(stat => {
            const details = [isNumericStat(stat) ? 'number' : 'text'];
            if (String(stat.purpose ?? '').trim()) details.push(`purpose: ${stat.purpose.trim()}`);
            const choices = deps.allowedValues(stat);
            if (choices.length) details.push(`choose one of ${choices.join(', ')}`);
            else if (isNumericStat(stat)) {
                if (stat.min !== undefined && String(stat.min).trim() !== '') details.push(`minimum ${stat.min}`);
                const max = resolveMaxValue(stat);
                if (max) details.push(`starting maximum ${max}`);
            }
            if (String(stat.defaultValue ?? '').trim()) details.push(`default ${stat.defaultValue}`);
            if (stat.locked) {
                details.push('reader may initialize once; later reader changes are blocked');
            }
            return `- ${stat.name}: ${details.join('; ')}`;
        })
        .join('\n');
}

/**
 * The ceiling a value carries, if it carries one - regardless of what it is for.
 *
 * @param {{maxStatValue?: string, defaultValue?: string}} statDef Unused for the ceiling
 *   itself; kept so callers read as "this stat, this value".
 * @param {string|number} rawValue
 */
function meterHasCeiling(statDef, rawValue) {
    // Through the shared reader rather than a parseFloat of its own, or this says yes to a
    // date: "14/01/2012" splits to a denominator of "01/2012", which parseFloat reads as 1.
    return ceilingFromValue(rawValue) !== null;
}

/**
 * Whether a stat is drawn as a meter.
 *
 * One function because there were two, in two files, disagreeing: the tracker box asked
 * the field type (status-ui.js) and the HUD asked the value (ui-hud.js), so a field
 * switched back to Text kept its meter on the HUD for as long as its value had a slash.
 * Both halves have to hold - it must be a quantity, and the quantity must have a ceiling
 * to fill. A bare 53 is just 53, and a bar pinned at 100% for the life of the chat was
 * never information.
 *
 * @param {object} statDef
 * @param {string|number} rawValue
 */
function drawsMeter(statDef, rawValue) {
    return isNumericStat(statDef) && meterHasCeiling(statDef, rawValue);
}

/**
 * Holds a value at its own ceiling.
 *
 * A value written as "cur/max" carries its ceiling with it, and that ceiling belongs to
 * the actor rather than to the stat definition: one character's Energy caps at 350 while
 * another's caps at 40, with nothing configured globally.
 *
 * This replaces a rule that did the opposite. When a stat had no configured maximum, the
 * "/max" was deleted from every value on load - so a character given a ceiling of 350 lost
 * it silently a few messages later, and with nothing left to cap them their Energy
 * climbed past 350 unopposed. Only characters who had been on stage were affected, which
 * is why some cards kept "150/150" while others had been flattened to a bare number.
 *
 * Non-numeric values are left alone: "???" and "Healthy" have no arithmetic to do.
 *
 * @param {string|number} value
 * @returns {string|number} The value, with its current half held at its maximum.
 */
function clampToCeiling(value) {
    if (value === undefined || value === null) return value;
    const text = String(value);
    if (!text.includes('/')) return value;

    const { current, max } = splitValue(text);
    const currentNum = Number(current);
    const maxNum = Number(max);
    if (!Number.isFinite(currentNum) || !Number.isFinite(maxNum)) return value;
    if (currentNum <= maxNum) return value;
    return `${max}/${max}`;
}

function getInitialStatValue(defaultValue, maxStatValue, statDef = null) {
    let value = defaultValue || '';
    return value;
}

/**
 * Gets the name of the currently selected user persona.
 */

Object.defineProperties(deps, {
    mergeStatValue: { enumerable: true, configurable: true, get: () => mergeStatValue },
    resolveMaxValue: { enumerable: true, configurable: true, get: () => resolveMaxValue },
    lockedStats: { enumerable: true, configurable: true, get: () => lockedStats },
    sanitizeModelUpdate: { enumerable: true, configurable: true, get: () => sanitizeModelUpdate },
    promptCeiling: { enumerable: true, configurable: true, get: () => promptCeiling },
    highestCeiling: { enumerable: true, configurable: true, get: () => highestCeiling },
    isNumericStat: { enumerable: true, configurable: true, get: () => isNumericStat },
    describeNpcStatFields: { enumerable: true, configurable: true, get: () => describeNpcStatFields },
    meterHasCeiling: { enumerable: true, configurable: true, get: () => meterHasCeiling },
    drawsMeter: { enumerable: true, configurable: true, get: () => drawsMeter },
    clampToCeiling: { enumerable: true, configurable: true, get: () => clampToCeiling },
    getInitialStatValue: { enumerable: true, configurable: true, get: () => getInitialStatValue },
});
}
