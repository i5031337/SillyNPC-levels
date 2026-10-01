import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from '../core/settings.js';
import { normaliseNpcPersistence, canTrackerSetNpcStat } from './stat-persistence.js';
import { isTurnStat, canAdvanceStat, earnsLevel } from './stat-update-policy.js';
import { extractJSON, safeJsonParse, splitValue, escapeRegExp, ceilingFromValue } from '../core/utils.js';
import { configuredNumericMaximum, keepNumericMaximum } from './numeric-stat-bounds.js';

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
    
    /* Two ceilings can apply, and this is the order of precedence.
     *
     * It used to be expressed as an early return - "no configured maximum, so send the new
     * value as it stands" - which put the second rule below a branch that could never reach
     * it. So a stat with no maxStatValue lost the actor's own ceiling the moment the model
     * reported a bare number, which is the usual shape for a model reporting a stat. That is
     * the same failure clampToCeiling's own note describes: a character given a ceiling of
     * 350 lost it silently a few messages later, and with nothing left to cap them their
     * Energy climbed past 350 unopposed.
     */

    // 1. The incoming value brought its own. "280/350" states a ceiling outright.
    if (strNew.includes('/')) return clampToCeiling(strNew.trim());

    /* 2. The actor's own, which the stat definition may know nothing about: one character's
     *    Energy caps at 350 while another's caps at 40, with nothing configured globally.
     *
     *    Only for a value being reported rather than written. A model answering "Energy: 80"
     *    is reading the current half of 280/350 and says nothing about the ceiling, so
     *    keeping it is the only honest reading. Somebody typing 80 into the field has
     *    written the whole value, and a rule that helpfully appends "/350" to it means the
     *    ceiling can be changed but never removed - which is exactly what it meant.
     */
    /* A number, or it is not a ceiling. A fill once wrote the words "current/maximum" into
       a new character's Health - the model copied the shape it was shown instead of filling
       it in - and from then on every value written to that field came back as
       "Observe the party dynamics./maximum", because the word after the slash was being kept
       as the ceiling. ceilingFromValue answers the same question for the prompts and the
       meters, and says no to a date for the same reason. */
    const parts = strOld.split('/');
    if (!verbatim && parts.length === 2 && ceilingFromValue(strOld) !== null) {
        return clampToCeiling(`${strNew.trim()}/${parts[1].trim()}`);
    }

    /* And deliberately no third. The configured maximum is a *starting* maximum: it seeds a
       stat the first time an actor is given one, and from then on the value is the only
       thing that says whether there is a ceiling at all. Appending it here put a ceiling
       back on any bare number, so a stat with a configured max could never lose one either. */
    return clampToCeiling(strNew.trim());
}

/**
 * A stat's *starting* maximum - the one a new actor is seeded with.
 *
 * Not the ceiling in play. That is read from the value itself, which is the only place it
 * can honestly live: one character's Energy caps at 350 while another's caps at 40, and
 * play raises a ceiling far more often than a setting does. This supplies the first one
 * and is not consulted again, which is what the System Builder box has said all along -
 * "Starting maximum only. The ceiling actually in play is read from the stat's own value."
 *
 * A default written as "10/10" supplies the max when none is set explicitly, so a system
 * configured that way seeds correctly without anyone having to fill in a second box.
 *
 * @param {{maxStatValue?: string, defaultValue?: string}} statDef
 * @returns {string} The starting max, or '' when the stat has none.
 */
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
            .filter(stat => stat?.name && (stat.locked || !isTurnStat(stat)))
            .map(stat => stat.name),
    };
}

/**
 * What a model's reply may not do to the stats, taken out before it is applied.
 *
 * Only for replies from a model - the tracker's reader and the inline block. Your own edits
 * never come through here, so typing "120/150" on the sheet still sets a ceiling.
 *
 * - An advancement-only stat is never changed by a turn reply. A locked NPC stat may be
 *   initialized while blank, then only you can change it.
 * - A ceiling the stat does not have is dropped. A stat holding a plain number keeps a plain
 *   number: "5/20" is stored as "5". Attributes that stayed plain until the first time they
 *   changed and then came back as "4/20" were this - a model copying the "current/maximum"
 *   form it saw elsewhere onto a score. For a pool, the existing maximum is retained;
 *   a configured starting maximum is used only for a blank value.
 *
 * @param {object} update Changed in place, and returned.
 * @param {object} state The state the reply is applied to.
 */
function sanitizeModelUpdate(update, state, trackerSettings = getSettings().statusTracker,
    { allowInlineLevelBonus = false } = {}) {
    if (!update || typeof update !== 'object') return update;
    const levelUp = allowInlineLevelBonus && earnsLevel(update, state);

    const clean = (stats, defs, stored, { npc = false, player = false, cardStats = {} } = {}) => {
        if (!stats || typeof stats !== 'object') return;
        for (const key of Object.keys(stats)) {
            const def = (defs || []).find(d => String(d?.name).toLowerCase() === key.toLowerCase());
            const maxFragment = key.match(/^(.*)_(?:maximum|max|total|cap)$/i);
            if (!def && maxFragment && (defs || []).some(d => d?.name?.toLowerCase() === maxFragment[1].toLowerCase()
                && isNumericStat(d))) {
                delete stats[key];
                continue;
            }
            if (!def) continue;
            const inlineBonus = player && levelUp
                && (def.name.toLowerCase() === 'level bonus' || canAdvanceStat(def));
            if (!isTurnStat(def) && !inlineBonus) { delete stats[key]; continue; }
            const held = stored?.[deps.findMatchingStatKey(stored || {}, key) || key];
            const cardHeld = cardStats?.[deps.findMatchingStatKey(cardStats || {}, key) || key];
            if (npc && !canTrackerSetNpcStat(def)) {
                delete stats[key];
                continue;
            }
            if (def.locked) {
                // A locked NPC stat may be seeded once, but a value already on its
                // card must also protect it while the character is off stage.
                if (!npc || String(held ?? '').trim() || String(cardHeld ?? '').trim()) {
                    delete stats[key];
                    continue;
                }
            }
            const incoming = String(stats[key] ?? '');
            if (isNumericStat(def) && (!inlineBonus || !isTurnStat(def))) {
                const storedValue = String(held ?? '').trim() ? held : cardHeld;
                const fixedCap = !isTurnStat(def) ? configuredNumericMaximum(def) : null;
                const liveCap = String(storedValue ?? '').includes('/')
                    ? fixedCap ?? promptCeiling(def, storedValue)
                    : promptCeiling(def, storedValue);
                stats[key] = keepNumericMaximum(incoming, liveCap);
            }
        }
    };

    clean(update.global, trackerSettings.globalStats, state?.global);
    if (update.player && typeof update.player === 'object') {
        // applyUpdate reads update.player.stats, or update.player itself when it is flat.
        const playerStats = update.player.stats && typeof update.player.stats === 'object'
            ? update.player.stats : update.player;
        clean(playerStats, trackerSettings.playerStats, state?.player?.stats, { player: true });
    }
    for (const actor of Array.isArray(update.characters) ? update.characters : []) {
        const current = (state?.characters || [])
            .find(c => String(c?.name).toLowerCase() === String(actor?.name).toLowerCase());
        clean(actor?.stats && typeof actor.stats === 'object' ? actor.stats : actor,
            trackerSettings.npcStats, current?.stats,
            { npc: true, cardStats: deps.findCardForName(actor?.name)?.statusOverrides });
    }
    return update;
}

/**
 * The ceiling to tell a model about.
 *
 * The value's own, whenever there is a value: once an actor holds "160/180" that is their
 * ceiling, and once they hold a bare "160" they have none and saying otherwise invents one.
 * The configured maximum stands in only for a stat nobody has a value for yet, which is the
 * one case where there is nothing else to read.
 *
 * @param {object} statDef
 * @param {string|number} [storedValue] The actor's value, if they have one.
 * @returns {string} The ceiling, or '' for none.
 */
function promptCeiling(statDef, storedValue) {
    const held = storedValue !== undefined && storedValue !== null && String(storedValue).trim() !== '';
    if (!held) return resolveMaxValue(statDef);
    if (ceilingFromValue(storedValue) === null) return '';
    return String(splitValue(storedValue).max).trim();
}

/**
 * The cast's highest ceiling for a stat, returned as the value that carries it.
 *
 * undefined when nobody holds the stat at all, so promptCeiling can fall back to the
 * configured maximum; a value with no ceiling when somebody holds it and none of them has
 * one, so that "they have no ceiling" survives rather than being read as "no data".
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

/**
 * Does this stat hold a quantity?
 *
 * The field type used to be Text or Meter, which named the drawing rather than the
 * content - so a field could be "a meter" while holding a date, and switching it back to
 * Text left the HUD still drawing one. Number is what was meant: it says the value is a
 * quantity, and whether a meter is drawn follows from the value.
 *
 * 'bar' is the old spelling and is still read, because a system preset saved before the
 * rename carries it and is applied without passing through the settings migration.
 *
 * @param {{type?: string}} statDef
 */
function isNumericStat(statDef) {
    const type = statDef?.type;
    return type === 'number' || type === 'bar';
}

/** The configured NPC fields, included in both tracker prompts for new arrivals. */
function describeNpcStatFields(trackerSettings) {
    return (trackerSettings?.npcStats || [])
        .filter(stat => stat?.name && isTurnStat(stat))
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
                details.push('immutable after its first value; never change it during play');
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
    if (maxStatValue && value && !String(value).includes('/') && isTurnStat(statDef)) {
        value = `${value}/${maxStatValue}`;
    }
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
