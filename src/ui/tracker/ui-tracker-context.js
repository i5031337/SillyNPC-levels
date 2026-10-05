import { Popup } from '../../../../../../popup.js';
import { getContext } from '../../../../../../st-context.js';
import { cleanChatHistory, measureChatOverhead, estimateTokens } from '../../tracker/status-history.js';

export function buildContextReport(onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';

    const title = document.createElement('h3');
    title.className = 'sillynpc-section-title';
    title.style.marginTop = '20px';
    title.textContent = 'Chat Size';
    wrap.appendChild(title);

    const body = document.createElement('div');
    wrap.appendChild(body);

    const render = () => {
        body.replaceChildren();
        const metadata = getContext()?.chatMetadata;

        let stats;
        try {
            stats = measureChatOverhead();
        } catch {
            const note = document.createElement('small');
            note.className = 'notes';
            note.textContent = 'No chat is open.';
            body.appendChild(note);
            return;
        }

        const totalTokens = estimateTokens(stats.totalChars);
        const blockTokens = estimateTokens(stats.blockChars);
        const share = stats.totalChars ? (stats.blockChars / stats.totalChars * 100) : 0;

        const summary = document.createElement('small');
        summary.className = 'notes';
        summary.style.display = 'block';
        summary.style.marginBottom = '8px';
        summary.textContent = `${stats.messages} messages, roughly ${totalTokens.toLocaleString()} tokens. `
            + (stats.blockMessages
                ? `${stats.blockMessages} of them still carry tracker data: about ${blockTokens.toLocaleString()} tokens (${share.toFixed(1)}%), re-sent on every turn.`
                : 'No leftover tracker data - nothing is being re-sent.');
        body.appendChild(summary);

        if (!stats.blockMessages) return;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button';
        button.innerHTML = '<i class="fa-solid fa-broom"></i> Remove tracker data from this chat';
        button.addEventListener('click', async () => {
            if (getContext()?.chatMetadata !== metadata) { render(); return; }
            const ok = await Popup.show.confirm(
                'Clean this chat?',
                `This removes the tracker's own JSON from ${stats.blockMessages} message(s), `
                + `recovering roughly ${blockTokens.toLocaleString()} tokens on every future request. `
                + 'The story text is untouched, and the removed data is kept hidden on each '
                + 'message so it can still be re-applied. Back up the chat first if you are unsure.');
            if (!ok || getContext()?.chatMetadata !== metadata) return;

            const result = cleanChatHistory();
            toastr.success(
                `Cleaned ${result.cleaned} message(s), recovering about `
                + `${estimateTokens(result.removedChars).toLocaleString()} tokens.`,
                'SillyNPC');
            render();
            onChange?.();
        });
        body.appendChild(button);
    };

    render();
    return wrap;
}
