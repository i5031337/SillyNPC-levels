import { manualLevelUps } from '../../tracker/manual-level-ups.js';
import { renderReviewPanel } from '../tracker/ui-change-review.js';

/** Card-owned controls; rewards stay with their chat rather than a story reply. */
export function buildManualLevelUpSection(card, { onChange = () => {}, service = manualLevelUps } = {}) {
    const section = document.createElement('section'); section.className = 'sillynpc-manual-level-up';
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'menu_button sillynpc-trigger-level-up'; button.textContent = 'Trigger Level-up';
    const info = service.info(card.id);
    button.disabled = !info.enabled || service.isBusy(card.id);
    button.title = info.reason || 'Advance one level, keep current XP, and review configured skill points and collection rewards.';
    const run = async action => {
        button.disabled = true;
        try { await action(); onChange(); }
        catch (error) { globalThis.toastr?.warning(error.message || String(error), 'SillyNPC'); }
        finally { if (button.isConnected) button.disabled = !service.info(card.id).enabled || service.isBusy(card.id); }
    };
    button.addEventListener('click', () => run(async () => {
        const record = await service.trigger(card.id);
        globalThis.toastr?.success(`${card.name} is now level ${record.newLevel}.`
            + (record.pending.length || record.failures.length ? ' Review the rewards below.' : ''), 'SillyNPC');
    }));
    section.append(button);
    if (!info.enabled) {
        const reason = document.createElement('small'); reason.className = 'notes'; reason.textContent = info.reason;
        section.append(reason);
    }
    for (const record of service.records(card.id)) {
        const group = document.createElement('div'); group.className = 'sillynpc-manual-level-up-review';
        const heading = document.createElement('strong'); heading.textContent = `Level ${record.oldLevel} → ${record.newLevel}`;
        group.append(heading);
        renderReviewPanel(group, record.id, {
            getPendingChanges: () => service.records(card.id).find(current => current.id === record.id)?.pending || [],
            resolvePendingChanges: (_id, accepted, _dismissed, options) => {
                const result = service.resolve(card.id, record.id, accepted, options); onChange(); return result;
            },
        });
        if (record.failures.length) {
            const note = document.createElement('small'); note.textContent = 'Some collection rewards could not be selected.';
            const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'menu_button';
            retry.textContent = 'Retry missing rewards'; retry.disabled = service.isBusy(card.id);
            retry.addEventListener('click', async () => {
                retry.disabled = true;
                await run(() => service.retry(card.id, record.id));
                if (retry.isConnected) retry.disabled = service.isBusy(card.id);
            });
            group.append(note, retry);
        }
        section.append(group);
    }
    return section;
}
