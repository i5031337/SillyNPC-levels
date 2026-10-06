import { getSettings } from '../core/settings.js';
import { getContext } from '../../../../../st-context.js';
import { hasOpenChat } from '../tracker/status-logic.js';
import { CAST_KEY, setChatCast, getAllCategories, UNCATEGORISED } from '../characters/characters.js';
import { triggerReprocess } from '../chat/chat.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../popup.js';

/**
 * Offers to scope a brand new chat to some of your categories.
 *
 * Deliberately narrow. It only asks for a chat that is genuinely new, has never been
 * scoped, and belongs to a system with more than one category to choose between - so it
 * appears when you are starting a story and never as noise on an ordinary chat switch.
 * Declining leaves the chat unscoped, which includes every character.
 */
export async function offerChatScope() {
    if (!getSettings().enabled || !hasOpenChat()) return;

    const context = getContext();
    if ((context?.chat?.length ?? 0) > 1) return;
    if (context?.chatMetadata?.[CAST_KEY]) return;

    const categories = getAllCategories();
    if (categories.length < 2) return;

    const wrap = document.createElement('div');
    const question = document.createElement('p');
    question.textContent = 'Which characters is this new story for?';
    wrap.append(question);

    const boxes = [];
    for (const category of [UNCATEGORISED, ...categories]) {
        const label = document.createElement('label');
        label.style.cssText = 'display:flex; align-items:center; gap:6px; margin:4px 0;';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.dataset.category = category;
        boxes.push(box);
        label.append(box, document.createTextNode(category || 'Uncategorised'));
        wrap.append(label);
    }

    const help = document.createElement('small');
    help.className = 'notes';
    help.style.cssText = 'display:block; margin-top:8px;';
    help.textContent = 'Tick nothing to include every character. '
        + 'You can change it any time from Manage SillyNPC.';
    wrap.append(help);

    const result = await new Popup(wrap, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Use these', cancelButton: 'All characters',
    }).show();
    if (result !== POPUP_RESULT.AFFIRMATIVE
        || getContext()?.chatMetadata !== context.chatMetadata) return;

    const chosen = boxes.filter(b => b.checked).map(b => b.dataset.category);
    if (!chosen.length) return;             // ticking nothing means the same as declining
    setChatCast({ categories: chosen, include: [], exclude: [] });
    triggerReprocess();
}
