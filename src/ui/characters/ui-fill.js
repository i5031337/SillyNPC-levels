import { Popup, POPUP_TYPE } from '../../../../../../popup.js';
// The chat shows this picture beside every line the character speaks, so changing
// it has to redraw. reprocess.js rather than chat.js: chat.js imports this file.
import { triggerReprocess } from '../../chat/reprocess.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { LOG_PREFIX, debugLog } from '../../core/constants.js';
import { auditCharacter, fillLore } from '../../characters/character-fill.js';
import { generateCharacterImageLogic } from '../../api/api.js';
import { automaticFillStages } from '../../prompts/fill-preset.js';

/**
 * One row of the plan: what this stage would do, and whether to do it.
 *
 * A stage already done is shown, ticked off and disabled, rather than left out. "There was
 * nothing to do" and "it did nothing" look identical when the row is simply absent, and
 * the second is the one worth noticing.
 *
 * The default tick is the stage's own answer rather than "not done": belongings are
 * offered on a character who already carries things, but not ticked.
 */
function stageRow(id, label, stage) {
    const row = document.createElement('label');
    row.className = 'sillynpc-fill-row';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'sillynpc-fill-check';
    box.dataset.stage = id;
    box.checked = stage.checked ?? !stage.done;
    box.disabled = stage.done;

    const text = document.createElement('span');
    text.className = 'sillynpc-fill-text';
    text.innerHTML = `<b>${label}</b><br><small class="notes">${stage.summary}</small>`;

    row.append(box, text);
    if (stage.done) row.classList.add('is-done');
    return row;
}

/**
 * Shows what filling this card would do, and asks.
 *
 * One decision rather than four: the whole point is doing it in one go, and the stages
 * worth declining, including the portrait, can be declined before they run.
 *
 * @returns {Promise<{ lore: boolean, image: boolean } | null>}
 *   Null on cancel.
 */
async function askPlan(char, audit) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-fill-plan';

    const heading = document.createElement('h3');
    heading.textContent = `Fill in ${char.name || 'this character'}`;
    wrap.append(heading);

    const intro = document.createElement('small');
    intro.className = 'notes';
    intro.textContent = 'Each stage feeds the next: the description and lore are written '
        + 'together, and both describe the portrait. Nothing '
        + 'already filled in is overwritten, and nothing you already carry is removed.';
    wrap.append(intro);

    // Numbered in the order they run; later stages can use the completed description.
    wrap.append(
        stageRow('lore', '1. Description & Lore', audit.lore),
        stageRow('image', '2. Portrait', audit.image),
    );

    const popup = new Popup(wrap, POPUP_TYPE.CONFIRM, '', {
        okButton: 'Fill', cancelButton: 'Cancel',
    });
    const result = await popup.show();
    if (!result) return null;

    const chosen = {};
    for (const box of wrap.querySelectorAll('.sillynpc-fill-check')) {
        chosen[box.dataset.stage] = box.checked && !box.disabled;
    }
    return chosen;
}

/**
 * Fills in a character card: lore, then a portrait.
 *
 * Stops at the first stage that fails and says which one. The stages are ordered because
 * each reads what the one before it wrote, so carrying on past a failure produces exactly
 * the thin, guessed-at card this exists to avoid - and whatever earlier stages finished
 * is kept, since undoing good work to report a later failure helps nobody.
 *
 * @param {object} char
 * @param {{ onSave?: () => void, preset?: 'automatic' }} [options]
 */
export async function fillCharacter(char, { onSave, preset } = {}) {
    if (!char?.name) {
        toastr.warning('Give the character a name first.', 'SillyNPC');
        return;
    }

    const audit = await auditCharacter(char);
    if (!audit.anything) {
        toastr.info(`${char.name} is already filled in.`, 'SillyNPC');
        return;
    }

    const chosen = preset === 'automatic'
        ? automaticFillStages(audit, getSettings().autoPortraitOnFill !== false)
        : await askPlan(char, audit);
    if (!chosen) return;
    if (!Object.values(chosen).some(Boolean)) return;

    const done = [];
    const retryStage = async (label, action, succeeded = result => result?.ok) => {
        while (true) {
            let result;
            let reason;
            try {
                result = await action();
                if (succeeded(result)) return result;
                reason = result?.reason || 'The response could not be used.';
            } catch (err) {
                console.error(LOG_PREFIX, `${label} failed`, err);
                reason = String(err?.message || err);
            }
            onSave?.();
            const message = document.createElement('div');
            message.textContent = `${label} failed: ${reason} Completed parts were kept. Try this step again?`;
            const retry = await new Popup(message, POPUP_TYPE.CONFIRM, '', {
                okButton: 'Retry', cancelButton: 'Stop',
            }).show();
            if (!retry) return null;
        }
    };

    /** @returns {Promise<boolean>} False when the run should stop. */
    const runLore = async () => {
        toastr.info('Looking for a lore entry...', 'SillyNPC');
        const result = await retryStage('Lore', () => fillLore(char));
        if (!result) return false;
        done.push(`Lore: ${result.action}`);
        onSave?.();
        return true;
    };

    try {
        // One request writes the named profile fields and the rest of the lore together.
        if (chosen.lore && !(await runLore())) return;

        if (chosen.image) {
            toastr.info('Drawing a portrait...', 'SillyNPC');
            const imageUrl = await retryStage('Portrait',
                () => generateCharacterImageLogic(char, { includeScene: false }), Boolean);
            if (!imageUrl) return;
            if (!Array.isArray(char.images)) char.images = [];
            if (!char.images.includes(imageUrl)) char.images.push(imageUrl);
            // The card had no portrait, which is why this stage ran - so it becomes the
            // one in use rather than sitting in the gallery unused.
            char.imageUrl = imageUrl;
            saveSettings();
            triggerReprocess();
            done.push('Portrait: drawn');
        }
    } catch (err) {
        console.error(LOG_PREFIX, 'Fill failed', err);
        toastr.error(`Stopped: ${err?.message || err}`, 'SillyNPC');
        onSave?.();
        return;
    }

    debugLog('Filled in', char.name, done);
    toastr.success(done.join('. ') + '.', 'SillyNPC');
    onSave?.();
}
