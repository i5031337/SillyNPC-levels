import { escapeHtml, escapeRegExp, computeStatBar, applyStatFormat, splitValue } from '../../core/utils.js';
import { findTemplateLabels, applyLabelFixes } from '../../ui/shared/template-labels.js';
import { BUILT_IN_DEFAULT_AVATAR } from '../../core/constants.js';
import { findCardForName, resolveMaxValue, drawsMeter } from '../status-logic.js';

/**
 * Compactly summarizes a collection for the UI.
 */
export function summarizeCollectionUI(collectionId, items, settings) {
    if (!items?.length) return null;
    
    const colDef = settings.collections.find(c => c.id === collectionId);
    if (!colDef || colDef.visible === false) return null;

    const colName = colDef.name || collectionId;
    const threshold = settings.summaryThreshold || 5;
    const displayItems = items.slice(0, threshold);
    const remainingCount = items.length - displayItems.length;

    const itemStrings = displayItems.map(item => {
        const primaryField = colDef.fields.find(f => f.isPrimary) || { name: 'name' };
        let str = item[primaryField.name] || item.name || 'Unknown Item';
        const qtyField = colDef.fields.find(f => f.type === 'number' && ['quantity', 'qty', 'count'].includes(f.name));
        const qty = qtyField ? item[qtyField.name] : item.quantity;
        return (qty > 1) ? `${str} (x${qty})` : str;
    });

    // Item names can contain commas (for example, "weathered, silver sword").
    // Give each item its own boundary so punctuation inside a name is unambiguous.
    let output = `<b>${escapeHtml(colName)}:</b> `
        + itemStrings.map(name => `<span class="sillynpc-status-collection-item">${escapeHtml(name)}</span>`).join(' ');
    if (remainingCount > 0) {
        output += ` <span class="sillynpc-status-collection-more">+${remainingCount} more...</span>`;
    }
    return output;
}

/**
 * Enhanced template engine for status box.
 */

/**
 * Portrait markup for a tracker row. Falls back to the built-in silhouette so a
 * character with no card still lines up with the others.
 */
export function buildPortraitHtml(name) {
    const card = findCardForName(name);
    const src = card?.imageUrl || BUILT_IN_DEFAULT_AVATAR;
    return `<img class="sillynpc-status-portrait" src="${escapeHtml(src)}" alt="" `
        + `title="${escapeHtml(name)}" loading="lazy">`;
}

/**
 * Takes a field out of a template: the reference, and the layout written around it.
 *
 * A field renders from the field list now, in the order the builder shows it, so a
 * reference in a template is not where it goes - it is a leftover from when templates
 * placed fields by hand. Left alone it would print `HP []`, so the caption beside it
 * and any separator left dangling go with it.
 *
 * These four steps were already here, duplicated for global and character fields, and
 * used only when a field was hidden. Hiding a field and no longer placing one want
 * exactly the same surgery.
 *
 * @param {string} text A template, or one character row of it.
 * @param {string} name The field name.
 * @returns {string}
 */
export function stripFieldReference(text, name) {
    if (!name) return text;
    const escaped = escapeRegExp(name);
    const at = (pattern) => new RegExp(pattern, 'gi');
    let out = text;

    // A conditional block goes whole, or removing its innards mangles what is left.
    out = out.replace(at(`{{#${escaped}}}[\\s\\S]*?{{\\/${escaped}}}`), '');
    // A caption written beside it. findTemplateLabels knows the bracket form -
    // `HP [{{Health}}]` - which the steps below never did: they were written when only
    // `Label:` existed, which is why an empty `HP []` was left behind.
    out = applyLabelFixes(out, findTemplateLabels(out, [name]));
    // And the colon form written across markup, which findTemplateLabels leaves alone
    // because it refuses to reach past a tag.
    out = out.replace(at(`(?:<[^>]+>)*[\\w\\s]+:(?:<\\/[^>]+>)?\\s*{{${escaped}}}\\s*(?:\\|\\s*)?`), '');
    // A separator with nothing left on one side of it.
    out = out.replace(at(`\\|\\s*{{${escaped}}}`), '');
    out = out.replace(at(`{{${escaped}}}\\s*\\|`), '');
    // And the reference itself.
    out = out.replace(at(`{{${escaped}}}`), '');

    return out;
}

/**
 * What to put between a row's own text and the fields appended after it.
 *
 * A row that already ends with a connector - `Goblin —` - has said how it joins to
 * what follows, and adding a pipe after it reads as punctuation nobody wrote.
 */
export function joinTo(text) {
    const trimmed = String(text ?? '').replace(/<[^>]*>\s*$/, '');
    return /[—–\-|:,]\s*$/.test(trimmed) ? ' ' : ' | ';
}

/**
 * Clears up what a stripped-out field leaves behind.
 *
 * A template written when references were placements wrapped them in markup and
 * separators: `<span class="sillynpc-stat-hp">HP [{{Health}}]</span> |`. Take the field
 * out and an empty shell and a stray pipe remain. This makes such a template readable;
 * Reset layout is how it becomes tidy.
 *
 * @param {string} text
 * @returns {string}
 */
export function tidyLeftovers(text) {
    let out = text;
    // An inline element with nothing left in it.
    out = out.replace(/<(span|b|i|em|strong)\b[^>]*>\s*<\/\1>/gi, '');
    // Separators that now sit against each other, or against the end of a row.
    out = out.replace(/\|(\s*\|)+/g, '|');
    out = out.replace(/(^|>)(\s*)\|\s*/g, '$1$2');
    out = out.replace(/\s*\|\s*(<\/div>|$)/g, '$1');
    return out;
}
// Stat replacement helper
export function replaceStatTag(template, statDef, rawValue, type, index = null) {
    const key = statDef.name;
    const dataIndex = index !== null ? ` data-index="${index}"` : '';
    /* data-initial is what the blur handler compares against, so a field that was
       clicked and left alone writes nothing. The same guard the item editor uses
       (ui-shared.js) and the player sheet learned in 0.5.1. */
    const editable = `<span class="sillynpc-status-editable" data-type="${type}"${dataIndex} data-key="${escapeHtml(key)}" data-initial="${escapeHtml(rawValue)}" contenteditable="true">${escapeHtml(rawValue)}</span>`;

    /* A Number whose value carries a ceiling keeps its editable value and gains a
       gauge behind it. The width is inline because it is per-value; everything else
       is themed CSS.

       drawsMeter is shared with the HUD, which is the point of it: this used to ask
       the field type and the HUD used to ask the value, so a field switched back to
       Text went on being drawn as a meter in one of the two places. It also decides
       from the value's own ceiling rather than the configured one, so a bare 53 is
       drawn as 53 instead of as a bar pinned at 100% for the life of the chat. */
    let valueSpan = editable;
    if (drawsMeter(statDef, rawValue)) {
        const { percent, numeric } = computeStatBar({
            rawValue,
            min: statDef.min,
        });
        if (numeric) {
            const slug = escapeHtml(String(key).toLowerCase().replace(/\s+/g, '-'));
            valueSpan = `<span class="sillynpc-status-meter" data-stat="${slug}">`
                + `<span class="sillynpc-status-meter-fill" style="width:${percent.toFixed(1)}%"></span>`
                + `<span class="sillynpc-status-meter-text">${editable}</span>`
                + `</span>`;
        }
    }
    
    const rendered = applyStatFormat(statDef.format, {
        value: valueSpan,
        name: escapeHtml(key),
        // {{max}} in a format is the ceiling in play, which is the one being shown
        // beside it - the configured one is only ever a starting value.
        max: escapeHtml(String(splitValue(rawValue).max ?? '') || resolveMaxValue(statDef) || ''),
    });
    
    const regex = new RegExp(`{{${escapeRegExp(key)}}}`, 'g');
    return template.replace(regex, rendered);
}

/**
 * Every visible field, in the order the builder lists them.
 *
 * One separator between entries and none in front, so a row that begins with
 * the set does not open with a stray pipe.
 */
export const renderFieldSet = (stats, valueFor, type, index = null) => stats
    .map(stat => replaceStatTag(`{{${stat.name}}}`, stat, valueFor(stat), type, index))
    .join(' | ');
