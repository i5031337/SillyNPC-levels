/**
 * Whether a mutated node sits inside the extension's own status box.
 *
 * Text nodes have no closest(), so the check climbs to the parent first rather than
 * testing nodeType against a constant the test environment does not define.
 *
 * @param {Node} node
 * @returns {boolean}
 */
export function insideTracker(node) {
    const el = node && typeof node.closest === 'function' ? node : node?.parentElement;
    return !!el?.closest?.('.sillynpc-status-tracker-container, .sillynpc-review-panel');
}

/**
 * Whether somebody is part-way through typing into the status box on this message.
 *
 * Redrawing then replaces the element under the cursor, so the caret is lost and the
 * half-typed value with it. Every redraw path is subject to this, not only the observer -
 * a status update arriving mid-edit would do the same. The edit is applied on blur, which
 * redraws, so nothing is missed by waiting.
 *
 * @param {Element} mesEl
 * @returns {boolean}
 */
export function isEditingInside(mesEl) {
    const active = document.activeElement;
    return !!active
        && typeof active.closest === 'function'
        && !!active.closest('.sillynpc-status-editable, .sillynpc-review-to')
        && mesEl.contains(active);
}
