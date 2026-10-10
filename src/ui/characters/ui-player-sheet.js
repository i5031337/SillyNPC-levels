import { getPlayerCard } from '../../tracker/status-logic.js';
import { resetLorebookState } from '../story/ui-lorebook-section.js';
import { renderCharacterEditor } from '../manage/ui-manage-editor.js';

const viewState = { charView: 'profile' };

export function openPlayerSheet() {
    return import('../manage/ui-manage.js').then(({ openManagePopup }) => openManagePopup({ tab: 'player' }));
}

/** Reuse the Cast editor with the active persona's card. */
export function renderPlayerView(view) {
    resetLorebookState();
    renderCharacterEditor(getPlayerCard(), view, { viewState });
}
