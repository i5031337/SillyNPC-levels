import { normalizeCharacterPresentation, normalizeSpriteFolder } from '../../core/npc-presentation.js';
import { saveSettings } from '../../core/settings.js';
import { getContext } from '../../../../../../st-context.js';
import { isChatCharacter } from '../../characters/character-repository.js';
import { triggerReprocess } from '../../chat/reprocess.js';
import { classifierHint, loadSpritePack } from '../../expressions/host-expressions.js';
import { selectSprite } from '../../expressions/expression-engine.js';

export function buildExpressionsSection(card, { save = () => {
    if (isChatCharacter(card.id)) getContext()?.saveMetadataDebounced?.();
    else saveSettings();
    triggerReprocess();
} } = {}) {
    const config = normalizeCharacterPresentation(card).expressions;
    const root = document.createElement('fieldset');
    root.className = 'sillynpc-expression-editor';
    const legend = document.createElement('legend'); legend.textContent = 'Dialogue expressions';
    root.append(legend);
    const field = (title, input) => {
        const label = document.createElement('label'); label.textContent = title; label.append(input); root.append(label);
    };
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = config.enabled;
    field('Automatic expressions', enabled);
    enabled.addEventListener('change', () => { config.enabled = enabled.checked; save(); });
    const folder = document.createElement('input'); folder.className = 'text_pole'; folder.value = config.spriteFolder;
    folder.placeholder = 'Existing pack, e.g. Mira/casual'; field('Sprite folder', folder);
    const fallback = document.createElement('input'); fallback.className = 'text_pole'; fallback.value = config.fallback;
    field('Fallback label', fallback);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'menu_button';
    button.textContent = 'Load pack / preview'; root.append(button);
    const status = document.createElement('p'); status.setAttribute('role', 'status'); root.append(status);
    const hint = document.createElement('p'); hint.textContent = classifierHint() || 'Classifies only each NPC’s last dialogue line in a completed reply.';
    root.append(hint);
    const preview = document.createElement('img'); preview.hidden = true; preview.alt = 'Expression preview';
    preview.style.cssText = 'width:100%;max-height:240px;object-fit:contain'; root.append(preview);
    const labels = document.createElement('select'); labels.className = 'text_pole'; labels.hidden = true;
    field('Preview expression', labels);
    let sprites = [], request = 0;
    const show = () => {
        const path = selectSprite(sprites, labels.value, config.fallback, card.id);
        preview.hidden = !path; if (path) preview.src = path;
    };
    preview.onerror = () => { preview.hidden = true; status.textContent = 'Sprite file unavailable; chat uses the base portrait.'; };
    labels.addEventListener('change', show);
    folder.addEventListener('change', () => {
        request++;
        const valid = normalizeSpriteFolder(folder.value);
        if (folder.value.trim() && !valid) {
            status.textContent = 'Use a folder and at most one subfolder.'; folder.value = config.spriteFolder; return;
        }
        config.spriteFolder = valid; config.bindingStatus = 'unverified';
        sprites = []; preview.hidden = true; labels.hidden = true; save();
    });
    fallback.addEventListener('change', () => { config.fallback = fallback.value.trim() || 'neutral'; save(); show(); });
    button.addEventListener('click', async () => {
        const version = ++request;
        try {
            const loaded = await loadSpritePack(config.spriteFolder);
            if (version !== request) return;
            sprites = loaded; labels.replaceChildren();
            for (const label of [...new Set(sprites.map(sprite => sprite.label))].sort()) {
                const option = document.createElement('option'); option.value = label; option.textContent = label; labels.append(option);
            }
            labels.hidden = !sprites.length;
            if ([...labels.options].some(option => option.value === config.fallback)) labels.value = config.fallback;
            status.textContent = sprites.length ? `${sprites.length} sprites available.` : 'No sprites found; chat uses the base portrait.';
            show();
        } catch (error) { if (version === request) status.textContent = error.message; }
    });
    return root;
}
