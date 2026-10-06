import { getContext } from '../../../../../st-context.js';
import { getAllCharacters, getChatCharacters, isChatCharacter } from '../characters/character-repository.js';
import { fillCharacter } from '../ui/characters/ui-fill.js';
import { fillNewCharacter } from '../ui/characters/ui-fill-new.js';
import { openManagePopup } from '../ui/manage/ui-manage.js';
import { openPlayerSheet } from '../ui/characters/ui-player-sheet.js';
import { createCharacter, addAlias, addCharacterToChat } from '../characters/characters.js';
import { triggerReprocess } from '../chat/chat.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../popup.js';

/**
 * Wire global click handling for injected avatars: your own portrait opens your sheet,
 * existing characters open their editor, and an unknown speaker gets a chat card and Fill.
 */
export function wireAvatarClicks() {
    const choosing = new Set();
    document.addEventListener('keydown', (e) => {
        if (e.target?.matches?.('.sillynpc-chat-avatar') && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            e.target.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: e.shiftKey }));
        }
    });
    document.addEventListener('click', async (e) => {
        const aliasButton = e.target.closest?.('.sillynpc-alias-link');
        if (aliasButton) {
            e.preventDefault();
            e.stopPropagation();
            const name = aliasButton.dataset.charName || '';
            const choice = await askAboutUnknownSpeaker(name);
            if (choice?.aliasOf) {
                addCharacterToChat(choice.aliasOf);
                if (addAlias(choice.aliasOf, name)) triggerReprocess();
            }
            return;
        }
        const avatar = e.target.closest?.('.sillynpc-chat-avatar');
        if (!avatar) return;
        e.preventDefault();
        e.stopPropagation();

        // Checked before the card, because the avatar is drawn that way round too: this
        // name is you, so it opens your sheet even if a card of the name exists.
        if (avatar.dataset.persona) {
            openPlayerSheet();
            return;
        }

        const charId = avatar.dataset.charId;
        if (charId) {
            const char = getAllCharacters().find(card => card.id === charId);
            if (char && !isChatCharacter(charId) && getContext()?.getCurrentChatId?.() !== undefined) {
                const key = `${getContext().getCurrentChatId()}:${charId}`;
                if (choosing.has(key)) return;
                choosing.add(key);
                try {
                    const metadata = getContext()?.chatMetadata;
                    const prompt = document.createElement('p');
                    prompt.textContent = `Create a new profile for "${char.name}" in this chat? `
                        + 'The reusable profile will stay available in other chats.';
                    const choice = await new Popup(prompt, POPUP_TYPE.CONFIRM, '', {
                        okButton: 'Create new profile', cancelButton: 'Edit reusable profile',
                    }).show();
                    if (getContext()?.chatMetadata !== metadata) return;
                    if (choice === POPUP_RESULT.CANCELLED) return;
                    if (choice !== POPUP_RESULT.AFFIRMATIVE) {
                        await openManagePopup({ tab: 'characters', charId });
                        return;
                    }
                    const local = getChatCharacters().find(card =>
                        String(card.name || '').trim().toLowerCase() === String(char.name || '').trim().toLowerCase())
                        || createCharacter(char.name);
                    addCharacterToChat(local.id);
                    triggerReprocess();
                    await fillCharacter(local, { preset: 'automatic', onSave: triggerReprocess });
                    return;
                } finally {
                    choosing.delete(key);
                }
            }
            await openManagePopup({ tab: 'characters', charId });
            return;
        }

        // The thumbnail starts Fill. Shift-click opens the alias action; there is also
        // a visible alias button beside an unknown speaker for touch and keyboard use.
        const speakerName = avatar.dataset.charName || '';
        if (e.shiftKey) {
            const choice = await askAboutUnknownSpeaker(speakerName);
            if (!choice) return;
            if (choice.aliasOf) {
            // Someone you are aliasing was spoken here, so they belong here.
                addCharacterToChat(choice.aliasOf);
                if (addAlias(choice.aliasOf, speakerName)) triggerReprocess();
            }
            return;
        }

        await fillNewCharacter(speakerName);
    });
}

/**
 * Lets an uncarded speaker be linked to an existing card by name.
 *
 * @param {string} speakerName
 * @returns {Promise<{ aliasOf: string|null }|null>} Null when dismissed.
 */
async function askAboutUnknownSpeaker(speakerName) {
    const metadata = getContext()?.chatMetadata;
    const existing = getAllCharacters().filter(c => c.name);

    const wrap = document.createElement('div');
    const question = document.createElement('p');
    question.textContent = speakerName
        ? `Link "${speakerName}" as an alias of an existing character?`
        : 'Link this speaker as an alias?';
    wrap.append(question);

    if (!existing.length || !speakerName) return null;

    const select = document.createElement('select');
    select.className = 'text_pole';
    select.style.width = '100%';

    const group = document.createElement('optgroup');
    group.label = `Or record "${speakerName}" as another name for…`;
    for (const char of existing) {
        const option = document.createElement('option');
        option.value = char.id;
        option.textContent = char.name;
        group.append(option);
    }
    select.append(group);
    wrap.append(select);

    const help = document.createElement('small');
    help.className = 'notes';
    help.style.cssText = 'display:block; margin-top:8px;';
    help.textContent = 'An alias makes both names resolve to the same character '
        + 'everywhere - the tracker, the lorebook and the scene cast, not only the avatar.';
    wrap.append(help);

    const result = await new Popup(wrap, POPUP_TYPE.CONFIRM, '', {
        okButton: 'OK', cancelButton: 'Cancel',
    }).show();
    if (result !== POPUP_RESULT.AFFIRMATIVE
        || getContext()?.chatMetadata !== metadata) return null;

    return { aliasOf: select.value || null };
}
