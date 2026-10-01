import { POPUP_TYPE, Popup } from '../../../../../../popup.js';
import { world_names } from '../../../../../../world-info.js';
import { getChatLorebookName } from '../../lore/lorebook.js';
import { getSettings } from '../../core/settings.js';
import { LOG_PREFIX } from '../../core/constants.js';
import { createLoreEntry, generateLoreContent, saveLoreContent } from '../../api/api.js';

function buildLoreDialog(char, defaultWorld) {
    const container = document.createElement('div');
    container.className = 'sillynpc-gen-popup';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '12px';

    const h = document.createElement('h3');
    h.textContent = char.lorebook ? `Regenerate Lore for ${char.name}` : `Generate Lore for ${char.name}`;
    container.append(h);

    // ─── Setup Row: Lorebook & Name (Hidden if already linked) ──────────
    const setupRow = document.createElement('div');
    setupRow.style.display = char.lorebook ? 'none' : 'grid';
    setupRow.style.gridTemplateColumns = '1fr 1fr';
    setupRow.style.gap = '10px';

    const worldField = document.createElement('div');
    worldField.className = 'sillynpc-editor-field';
    const worldLabel = document.createElement('label');
    worldLabel.textContent = 'Target Lorebook';
    const worldSelect = document.createElement('select');
    worldSelect.className = 'text_pole';
    // SillyTavern declares `export let world_names;` and fills it during its own startup,
    // so it can legitimately be undefined here.
    const worlds = Array.isArray(world_names) ? world_names : [];
    for (const name of worlds) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        if (name === (char.lorebook?.world || defaultWorld || getSettings().defaultLorebook || getChatLorebookName())) opt.selected = true;
        worldSelect.append(opt);
    }
    worldField.append(worldLabel, worldSelect);

    const nameField = document.createElement('div');
    nameField.className = 'sillynpc-editor-field';
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Entry Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'text_pole';
    nameInput.value = char.name;
    nameField.append(nameLabel, nameInput);

    setupRow.append(worldField, nameField);
    container.append(setupRow);

    // ─── Create Row ─────────────────────────────────────────────────────
    //
    // There was a "Connection Profile" select here with one hardcoded option that was
    // never read: generation runs through generateQuietPrompt on whatever profile is
    // current, and always did. A control that does nothing is worse than no control.
    const actionRow = document.createElement('div');
    actionRow.style.display = 'flex';
    actionRow.style.alignItems = 'flex-end';
    actionRow.style.gap = '10px';

    const profileField = document.createElement('div');
    profileField.className = 'sillynpc-editor-field';
    profileField.style.flex = '1';

    // With no lorebook at all, Create can only fail - say so where it is about to be
    // clicked, rather than after.
    if (!worlds.length) {
        const warn = document.createElement('small');
        warn.className = 'notes';
        warn.textContent = 'No lorebooks exist yet. Create one in SillyTavern\'s World Info '
            + 'panel first, then come back.';
        profileField.append(warn);
    }

    const createBtn = document.createElement('button');
    createBtn.type = 'button';
    createBtn.className = 'menu_button';
    createBtn.style.height = '32px';
    createBtn.style.display = char.lorebook ? 'none' : '';
    createBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Create Entry';
    createBtn.disabled = !worlds.length;

    actionRow.append(profileField, createBtn);
    container.append(actionRow);

    // ─── Status & Created Info ──────────────────────────────────────────
    const statusBox = document.createElement('div');
    statusBox.className = 'sillynpc-lorebook-preview';
    statusBox.style.minHeight = '40px';
    statusBox.style.fontSize = '0.9em';
    statusBox.innerHTML = char.lorebook 
        ? `<span style="color:var(--SmartThemeQuoteColor)">Linked to entry "${char.lorebook.world} / #${char.lorebook.uid}"</span>`
        : '<i class="notes">Entry not yet created...</i>';
    container.append(statusBox);

    // ─── Generation Results ─────────────────────────────────────────────
    const resultsContainer = document.createElement('div');
    resultsContainer.style.display = char.lorebook ? 'flex' : 'none';
    resultsContainer.style.flexDirection = 'column';
    resultsContainer.style.gap = '12px';

    const resultsTitle = document.createElement('h4');
    resultsTitle.textContent = 'Generation Results';
    resultsTitle.style.margin = '10px 0 0 0';
    resultsContainer.append(resultsTitle);

    // Sits above the boxes so a reply that ignored the instruction cannot look like a
    // result. Hidden until there is something to say.
    const resultWarning = document.createElement('div');
    resultWarning.className = 'sillynpc-lore-warning';
    resultWarning.style.display = 'none';
    resultsContainer.append(resultWarning);

    const tagsField = document.createElement('div');
    tagsField.className = 'sillynpc-editor-field';
    const tagsLabel = document.createElement('label');
    tagsLabel.textContent = 'Generated Tags';
    const tagsInput = document.createElement('input');
    tagsInput.type = 'text';
    tagsInput.className = 'text_pole';
    tagsInput.placeholder = 'Tags will appear here...';
    tagsField.append(tagsLabel, tagsInput);
    resultsContainer.append(tagsField);

    const descField = document.createElement('div');
    descField.className = 'sillynpc-editor-field';
    const descLabel = document.createElement('label');
    descLabel.textContent = 'Generated Description';
    const descText = document.createElement('textarea');
    descText.className = 'text_pole';
    descText.rows = 8;
    descText.placeholder = 'Description will appear here...';
    descField.append(descLabel, descText);
    resultsContainer.append(descField);
    container.append(resultsContainer);

    // ─── Final Actions ──────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.className = 'sillynpc-lorebook-actions';
    
    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'menu_button';
    genBtn.style.display = char.lorebook ? '' : 'none';
    genBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Start Generation';

    const saveCloseBtn = document.createElement('button');
    saveCloseBtn.type = 'button';
    saveCloseBtn.className = 'menu_button';
    saveCloseBtn.style.display = 'none';
    saveCloseBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save & Close';

    footer.append(genBtn, saveCloseBtn);
    container.append(footer);

    return {
        container, setupRow, worldSelect, nameInput, createBtn, statusBox,
        resultsContainer, genBtn, saveCloseBtn, tagsInput, descText, resultWarning,
    };
}

export async function generateLoreEntry(char, { onSave, template, facts, defaultWorld } = {}) {
    if (!char.name) {
        toastr.warning('Please give the character a name first.', 'SillyNPC');
        return;
    }

    const {
        container, setupRow, worldSelect, nameInput, createBtn, statusBox,
        resultsContainer, genBtn, saveCloseBtn, tagsInput, descText, resultWarning,
    } = buildLoreDialog(char, defaultWorld);

    /* ?? rather than ||: an entry's uid can be 0 - the first entry of a lorebook - and
       0 read as "no entry" made Generate and Regen do nothing at all for it. */
    let createdUid = char.lorebook?.uid ?? null;
    let createdWorld = char.lorebook?.world || null;

    // Set while a generation is in flight so onClosing can veto the close.
    let isGenerating = false;

    const popup = new Popup(container, POPUP_TYPE.DISPLAY, '', {
        onOpen: (p) => { p.dlg.style.width = '650px'; },
        onClosing: () => {
            if (isGenerating) {
                toastr.info('Generation in progress, please wait.', 'SillyNPC');
                return false;
            }
            return true;
        },
    });

    createBtn.addEventListener('click', async () => {
        const targetWorld = worldSelect.value;
        const entryName = nameInput.value.trim();
        if (!entryName) return toastr.warning('Please enter an entry name.');

        try {
            createBtn.disabled = true;
            const { uid } = await createLoreEntry(char, targetWorld, entryName);
            
            createdUid = uid;
            createdWorld = targetWorld;
            
            statusBox.innerHTML = `<span style="color:var(--SmartThemeGreenColor)">✓ Entry "${entryName}" created (UID: ${uid}) in "${targetWorld}"</span>`;
            toastr.success('Lorebook entry created!');
            
            resultsContainer.style.display = 'flex';
            genBtn.style.display = '';
            setupRow.style.display = 'none';
            createBtn.style.display = 'none';
        } catch (err) {
            console.error(LOG_PREFIX, 'Failed to create lore entry', err);
            toastr.error(String(err?.message || err), 'SillyNPC');
            createBtn.disabled = false;
        }
    });

    genBtn.addEventListener('click', async () => {
        if (createdUid == null) return;
        genBtn.disabled = true;
        isGenerating = true;

        try {
            toastr.info('Generating tags and description...');
            
            const { tags, content, followedFormat, truncated, excerpt } =
                await generateLoreContent(char, createdWorld, createdUid, { template, facts });

            tagsInput.value = tags;
            descText.value = content;

            // Shown either way, so a usable answer can still be salvaged - but never
            // presented as though it worked.
            resultWarning.style.display = followedFormat && !truncated ? 'none' : '';
            const warnings = [];
            if (!followedFormat) {
                warnings.push(`This reply did not use the required ${template ? 'Tags/Content' : 'YAML tags/content and named-field'} `
                    + 'format. Check it before saving. The instruction may not have reached the model - '
                    + 'most often because the request was too large. Try a smaller Chat To Read '
                    + 'or Excerpt Size Limit.');
            }
            if (truncated) {
                warnings.push('The model stopped at its reply token limit. This lore may be incomplete; check it before saving.');
                toastr.warning('Lore reply may be incomplete (reply token limit).', 'SillyNPC');
            }
            resultWarning.textContent = warnings.join(' ');

            saveCloseBtn.style.display = '';
            if (excerpt?.trimmed) {
                toastr.info(
                    `Read ${excerpt.used} of ${excerpt.available} messages (excerpt size limit).`,
                    'SillyNPC');
            }
            toastr.success('Generation complete.');
        } catch (err) {
            console.error(LOG_PREFIX, 'Lore generation failed', err);
            toastr.error(String(err?.message || err), 'SillyNPC');
        } finally {
            genBtn.disabled = false;
            isGenerating = false;
        }
    });

    saveCloseBtn.addEventListener('click', async () => {
        if (createdUid == null || !createdWorld) return;
        try {
            saveCloseBtn.disabled = true;
            saveCloseBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving...';

            const saved = await saveLoreContent(char, createdWorld, createdUid, tagsInput.value, descText.value,
                { preserveEmpty: true });
            
            toastr.success(saved?.profileFieldsSaved
                ? `Lorebook entry updated; ${saved.profileFieldsSaved} named field(s) saved to the profile.`
                : 'Lorebook entry updated; no named profile fields were found.');
            popup.completeCancelled();
            onSave?.();
        } catch (err) {
            toastr.error(`Save failed: ${err.message || err}`);
            saveCloseBtn.disabled = false;
            saveCloseBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save & Close';
        }
    });

    await popup.show();
}
