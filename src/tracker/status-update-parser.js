import { LOG_PREFIX, debugLog, PROFILE_FIELDS, isStaticField } from '../core/constants.js';
import { extractJSON, safeJsonParse, splitValue, escapeRegExp, currentMessageIndex, ceilingFromValue } from '../core/utils.js';

export function bind(deps) {
function parseMessageForUpdates(text) {
    if (!text) return { cleanedText: text, update: null, matchLength: 0 };

    // More lenient tag matching
    const tagMatch = text.match(/<\s*status_update\s*>([\s\S]*?)(?:<\s*\/\s*status_update\s*>|<\s*\/\s*status_update|<\s*\/\s*status_|$)/i);
    
    let jsonPart = '';
    let matchStr = '';

    if (tagMatch) {
        jsonPart = tagMatch[1];
        matchStr = tagMatch[0];
    } else {
        // Fallback for a block with no usable tag - a truncated reply, or a model that
        // emitted bare JSON.
        //
        // The nearest '{' before a root key is a NESTED one: for
        // {"global":{"Location":...}} it finds the brace after "global":, whose object
        // has no global/player/characters key, so applyUpdate silently did nothing and
        // only part of the block was ever removed. Walk left through the candidate
        // braces and keep the OUTERMOST one that actually parses as an update.
        const keys = ['"global"', "'global'", '"player"', "'player'", '"characters"', "'characters'"];
        let earliestKey = Infinity;
        for (const key of keys) {
            const idx = text.indexOf(key);
            if (idx !== -1 && idx < earliestKey) earliestKey = idx;
        }

        if (earliestKey !== Infinity) {
            let root = -1;
            let searchFrom = earliestKey;
            while (searchFrom >= 0) {
                const brace = text.lastIndexOf('{', searchFrom);
                if (brace === -1) break;
                const candidate = safeJsonParse(extractJSON(text.slice(brace)));
                if (candidate && (candidate.global !== undefined
                    || candidate.player !== undefined
                    || candidate.characters !== undefined)) {
                    root = brace;
                }
                searchFrom = brace - 1;
            }
            if (root !== -1) {
                jsonPart = text.substring(root);
                matchStr = jsonPart;
            }
        }
    }

    if (!jsonPart) return { cleanedText: text, update: null, matchLength: 0 };

    const jsonStr = extractJSON(jsonPart);
    const update = safeJsonParse(jsonStr);

    if (update) {
        debugLog('Found update in message, parsing reasoning...');
        // Use the actually parsed JSON string for matching to be precise
        const idx = text.lastIndexOf(jsonStr);
        if (idx === -1) {
            debugLog('Could not find JSON string in text for surgical removal');
            // Fallback to matchStr if jsonStr is somehow not found (shouldn't happen)
            const fallbackIdx = text.lastIndexOf(matchStr);
            if (fallbackIdx === -1) return { cleanedText: text, update: null, matchLength: 0 };
            const cleanedText = text.substring(0, fallbackIdx).replace(/\s+$/, '');
            const trueLength = text.length - cleanedText.length;
            return { cleanedText, update, matchLength: trueLength };
        }
        
        // Check if there was a tag wrapping it
        let finalIdx = idx;
        if (tagMatch && text.substring(0, idx).includes('<status_update>')) {
            const tagIdx = text.lastIndexOf('<status_update>', idx);
            if (tagIdx !== -1) finalIdx = tagIdx;
        }

        // Phase 5: Also hide "Reasoning:" block if it immediately precedes the update
        // Look for "Reasoning:" or "Reasoning: ..." at the start of a line
        const prefix = text.substring(0, finalIdx);
        
        // Find "Reasoning:" case-insensitively
        // We look for the LAST occurrence of "Reasoning:" that is followed by the status update
        const reasoningRegex = /(?:\n|^)\s*Reasoning\s*:\s*/gi;
        let lastReasoningIdx = -1;
        let m;
        while ((m = reasoningRegex.exec(prefix)) !== null) {
            lastReasoningIdx = m.index;
        }
        
        if (lastReasoningIdx !== -1) {
            // Check if there's an actual newline or start of string at the match index
            // to ensure we aren't matching "The Reasoning: " mid-sentence.
            const isAtLineStart = lastReasoningIdx === 0 || text[lastReasoningIdx - 1] === '\n' || text[lastReasoningIdx] === '\n';
            
            // Heuristic: The reasoning block should be relatively close to the update
            const distance = prefix.length - lastReasoningIdx;
            const isCloseEnough = distance < 1000;
            
            // We should only hide it if it's clearly at the end of the message
            // or if it's taking up a reasonable portion of the text.
            const isNotTooMuch = (distance + (text.length - finalIdx)) < (text.length * 0.8) || text.length < 500;

            if (isCloseEnough && isNotTooMuch && isAtLineStart) {
                finalIdx = lastReasoningIdx;
            }
        }

        const cleanedText = text.substring(0, finalIdx).replace(/\s+$/, '');
        const trueLength = text.length - cleanedText.length;
        debugLog(`Surgical removal length: ${trueLength}`);
        
        return { cleanedText, update, matchLength: trueLength };
    }

    // Fallback: If we matched a status_update block or JSON tag but parsing failed, 
    // surgically remove/hide the unparseable content anyway so raw markup/broken JSON is never shown.
    const fallbackIdx = text.lastIndexOf(matchStr);
    if (fallbackIdx !== -1) {
        let finalIdx = fallbackIdx;
        if (tagMatch && text.substring(0, fallbackIdx).includes('<status_update>')) {
            const tagIdx = text.lastIndexOf('<status_update>', fallbackIdx);
            if (tagIdx !== -1) finalIdx = tagIdx;
        }
        
        // Also hide any preceding "Reasoning:" prefix
        const prefix = text.substring(0, finalIdx);
        const reasoningRegex = /(?:\n|^)\s*Reasoning\s*:\s*/gi;
        let lastReasoningIdx = -1;
        let m;
        while ((m = reasoningRegex.exec(prefix)) !== null) {
            lastReasoningIdx = m.index;
        }
        if (lastReasoningIdx !== -1) {
            const isAtLineStart = lastReasoningIdx === 0 || text[lastReasoningIdx - 1] === '\n' || text[lastReasoningIdx] === '\n';
            const distance = prefix.length - lastReasoningIdx;
            if (distance < 1000 && isAtLineStart) {
                finalIdx = lastReasoningIdx;
            }
        }

        const cleanedText = text.substring(0, finalIdx).replace(/\s+$/, '');
        const trueLength = text.length - cleanedText.length;
        debugLog(`Surgical removal of unparseable block length: ${trueLength}`);
        return { cleanedText, update: null, matchLength: trueLength };
    }

    return { cleanedText: text, update: null, matchLength: 0 };
}

/**
 * Suffixes models use to address one half of a "cur/max" stat.
 * Order matters only in that longer suffixes must not be shadowed by shorter ones.
 */
const STAT_PART_SUFFIXES = {
    current: ['_current', '_cur', '_now', '_value', '_val'],
    max: ['_maximum', '_max', '_total', '_cap'],
};

/**
 * Splits "energy_current" into { base: 'energy', part: 'current' }.
 * A key with no recognised suffix comes back as { base: key, part: null }.
 *
 * @param {string} key
 * @returns {{ base: string, part: 'current'|'max'|null }}
 */
function splitStatKeyPart(key) {
    const lower = String(key).toLowerCase();
    for (const [part, suffixes] of Object.entries(STAT_PART_SUFFIXES)) {
        for (const suffix of suffixes) {
            if (lower.length > suffix.length && lower.endsWith(suffix)) {
                return { base: String(key).slice(0, -suffix.length), part: /** @type {'current'|'max'} */ (part) };
            }
        }
    }
    return { base: String(key), part: null };
}

/**
 * Buckets incoming stat keys by the stat they actually address.
 *
 * Without this, "hp_current" and "hp_max" both resolved to HP and were applied one
 * after another, so the result depended on JSON key order - which no model guarantees.
 * Grouping first means both halves are combined once, deterministically.
 *
 * @param {Record<string, any>} sourceStats Raw stats object from the model.
 * @param {(key: string) => string|null} resolveBase Maps a bare name to a real stat key.
 * @param {(key: string) => boolean} isExactStat True if the key IS a configured stat.
 * @param {(key: string) => boolean} shouldSkip Keys to ignore entirely.
 * @returns {Map<string, { whole?: any, current?: any, max?: any }>}
 */
function groupIncomingStats(sourceStats, resolveBase, isExactStat, shouldSkip) {
    const groups = new Map();

    for (const updKey of Object.keys(sourceStats)) {
        if (shouldSkip(updKey)) continue;

        let actualKey = null;
        let part = null;

        // A stat genuinely named like the key (say a user stat called "HP Max") wins
        // over reading the key as a suffix.
        if (isExactStat(updKey)) {
            actualKey = resolveBase(updKey) || updKey;
        } else {
            const split = splitStatKeyPart(updKey);
            if (split.part) {
                const baseMatch = resolveBase(split.base);
                if (baseMatch) { actualKey = baseMatch; part = split.part; }
            }
            if (!actualKey) actualKey = resolveBase(updKey);
        }

        if (!actualKey) {
            debugLog('Ignoring stat key that matches no configured stat:', updKey);
            continue;
        }

        const group = groups.get(actualKey) || {};
        if (part) group[part] = sourceStats[updKey];
        else group.whole = sourceStats[updKey];
        groups.set(actualKey, group);
    }

    return groups;
}

/**
 * Folds a grouped update into a stat's existing value.
 *
 * @param {any} existingValue
 * @param {{ whole?: any, current?: any, max?: any }} group
 * @param {object} statDef
 * @returns {any}
 */

Object.defineProperties(deps, {
    parseMessageForUpdates: { enumerable: true, configurable: true, get: () => parseMessageForUpdates },
    splitStatKeyPart: { enumerable: true, configurable: true, get: () => splitStatKeyPart },
    groupIncomingStats: { enumerable: true, configurable: true, get: () => groupIncomingStats },
});
}
