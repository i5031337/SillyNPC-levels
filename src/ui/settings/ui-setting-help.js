let nextHelpId = 0;

/** Shared help, outside the control's label so tapping it cannot change a setting. */
export function appendSettingHelp(wrap, help) {
    if (!help) return;
    const row = wrap.querySelector('.sillynpc-setting-row');
    const heading = document.createElement('div');
    heading.className = 'sillynpc-setting-heading';
    row.before(heading);
    heading.append(row);

    const hint = document.createElement('span');
    hint.className = 'sillynpc-setting-help';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sillynpc-setting-help-button';
    const label = row.querySelector('.sillynpc-setting-label')?.textContent
        ?? row.textContent;
    button.setAttribute('aria-label', `Help: ${label.trim()}`);
    button.innerHTML = '<i class="fa-solid fa-circle-info" aria-hidden="true"></i>';

    // The top layer keeps long hints clear of scrolling panels and modal edges.
    const note = document.createElement('div');
    note.className = 'sillynpc-setting-help-note';
    note.id = `sillynpc-setting-help-${++nextHelpId}`;
    note.setAttribute('popover', 'auto');
    note.setAttribute('role', 'tooltip');
    note.textContent = help;
    button.setAttribute('aria-describedby', note.id);
    button.setAttribute('aria-expanded', 'false');
    button.popoverTargetElement = note;
    button.popoverTargetAction = 'show';
    hint.append(button, note);
    heading.append(hint);

    let closeTimer;
    const close = () => note.hidePopover();
    const onScroll = event => { if (!note.contains(event.target)) close(); };
    const onKeyDown = event => {
        if (event.key !== 'Escape' || !note.matches(':popover-open')) return;
        event.preventDefault();
        event.stopPropagation();
        close();
    };
    const show = () => {
        clearTimeout(closeTimer);
        if (!note.isConnected) return;
        note.showPopover();
        const anchor = button.getBoundingClientRect();
        const margin = 8;
        const width = note.offsetWidth;
        const height = note.offsetHeight;
        note.style.left = `${Math.max(margin, Math.min(anchor.right - width,
            window.innerWidth - width - margin))}px`;
        const below = anchor.bottom + 6;
        const top = below + height <= window.innerHeight - margin
            ? below : anchor.top - height - 6;
        note.style.top = `${Math.max(margin, top)}px`;
    };
    const scheduleClose = () => {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
            if (!hint.matches(':hover') && !hint.contains(document.activeElement)) close();
        }, 150);
    };
    hint.addEventListener('pointerenter', event => {
        if (event.pointerType !== 'touch') show();
    });
    hint.addEventListener('pointerleave', scheduleClose);
    hint.addEventListener('focusin', show);
    hint.addEventListener('focusout', scheduleClose);
    button.addEventListener('click', show);
    note.addEventListener('toggle', () => {
        const open = note.matches(':popover-open');
        button.setAttribute('aria-expanded', String(open));
        // A scrolled setting should not leave its hint floating elsewhere.
        document.removeEventListener('scroll', onScroll, true);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', close);
        if (open) {
            document.addEventListener('scroll', onScroll, true);
            document.addEventListener('keydown', onKeyDown, true);
            window.addEventListener('resize', close);
        }
    });
}
