export * from '../settings/ui-setting-controls.js';
export * from '../collections/ui-collection.js';
export * from './ui-theme.js';

export { choiceEntries, buildChoiceSelect, choiceOptionsHtml, isChoiceField } from './ui-choice.js';

/**
 * Hides a heading whose every control is hidden.
 *
 * Marking settings advanced empties whole sections - If Something Goes Wrong is three
 * budgets and nothing else - and a heading with nothing under it reads as something that
 * failed to load rather than as something deliberately not shown.
 *
 * By what is visible rather than by what it knows: a section can hold a button, a note or
 * a connection picker as well as settings, and a rule naming the kinds it expects would
 * hide a section the moment somebody put something else in one.
 *
 * @param {HTMLElement} view A rendered panel.
 */
export function hideEmptySections(view) {
    if (!view) return;
    const isHeading = (el) => {
        const cls = String(el?.className || '');
        return cls.includes('sillynpc-section-title') || cls.includes('sillynpc-subsection-title');
    };

    const children = [...(view.children || [])];
    for (let i = 0; i < children.length; i++) {
        if (!isHeading(children[i])) continue;

        let anythingVisible = false;
        let j = i + 1;
        for (; j < children.length && !isHeading(children[j]); j++) {
            if (children[j].style?.display !== 'none') { anythingVisible = true; break; }
        }
        children[i].style.display = anythingVisible ? '' : 'none';
    }
}
