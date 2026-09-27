/** Hides raw status data while preserving the rest of the rendered message. */

/**
 * Hides status data by finding the tags/JSON in the text and removing it.
 * Uses a robust approach that maps textContent offsets to DOM nodes.
 * @param {Element} container The container to hide text from.
 * @param {number} lengthToHide The number of characters to hide from the end.
 */
export function hideStatusDataSurgically(container, lengthToHide) {
    if (!lengthToHide || lengthToHide <= 0) return;

    const fullText = container.textContent;
    const totalLength = fullText.length;
    const startOffset = totalLength - lengthToHide;
    
    let currentOffset = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null, false);
    let node;
    const nodesToHide = [];
    let splitNode = null;
    let splitPoint = 0;
    let foundStart = false;

    while (node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) {
            const len = node.nodeValue.length;
            
            if (!foundStart) {
                if (currentOffset + len > startOffset) {
                    splitNode = node;
                    splitPoint = startOffset - currentOffset;
                    foundStart = true;
                }
            } else {
                nodesToHide.push(node);
            }
            
            currentOffset += len;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const tagName = node.tagName.toLowerCase();
            
            // If it's a known marker tag or we've passed the offset
            if (tagName === 'status_update' || foundStart || currentOffset >= startOffset) {
                // If it's a block element and we are at the start, we might want to hide the whole block
                // but only if it's not the container itself.
                if (node !== container) {
                    nodesToHide.push(node);
                    foundStart = true;
                }
            }
        }
    }

    if (splitNode) {
        splitNode.nodeValue = splitNode.nodeValue.substring(0, splitPoint);
    }

    for (const n of nodesToHide) {
        if (n.nodeType === Node.TEXT_NODE) {
            n.nodeValue = '';
        } else if (n.nodeType === Node.ELEMENT_NODE) {
            n.style.display = 'none';
            n.setAttribute('data-sillynpc-hidden', 'true');
        }
    }
    
    // Recursively hide siblings of hidden elements to be sure
    // and cleanup trailing artifacts.
    let current = container.lastChild;
    while (current) {
        const next = current.previousSibling;
        if (current.nodeType === Node.TEXT_NODE) {
            if (!current.nodeValue.trim()) {
                current.nodeValue = ''; 
                current = next;
                continue;
            }
            break;
        } else if (current.nodeType === Node.ELEMENT_NODE) {
            const tag = current.tagName;
            const isHidden = current.style.display === 'none' || current.getAttribute('data-sillynpc-hidden') === 'true';
            const isEmpty = current.textContent.trim() === '';
            
            // Only hide trailing BRs, empty elements, or elements already marked as hidden.
            // Do NOT hide non-empty P tags unless they were already hidden by the TreeWalker.
            if (tag === 'BR' || isHidden || isEmpty) {
                current.style.display = 'none';
                current.setAttribute('data-sillynpc-hidden', 'true');
                current = next;
                continue;
            }
            break;
        } else {
            break;
        }
    }
}

/**
 * Whether a rendered box has anything in it worth drawing.
 *
 * `.trim()` was the old test, and it answers the wrong question: a box stripped of its
 * header and its characters is still `<div class="sillynpc-status-box"></div>`, which is
 * not blank but has nothing in it. That combination is reachable - World Stats off, and
 * the eye on globals - and drew an empty bordered rectangle holding only its own buttons.
 *
 * @param {string} html
 * @returns {boolean}
 */
export function hasVisibleContent(html) {
    const text = String(html ?? '')
        // An <img> or a meter is content even though it contributes no text.
        .replace(/<(img|hr|input)\b[^>]*>/gi, 'x')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ');
    return text.trim().length > 0;
}
