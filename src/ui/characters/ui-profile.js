import { LOG_PREFIX } from '../../core/constants.js';
import { profileFieldsForCard, profileFieldValue } from '../../core/profile-fields.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { liveFactsFor } from '../../api/api.js';
import { readLoreEntry, fillProfile } from '../../characters/character-fill.js';
import { openLightbox } from './ui-portrait.js';
import { syncProfileToLore, readLoreValues } from '../../lore/lore-sync.js';
import { renderCharacterMemorySection } from './ui-character-memory-section.js';
import { buildProfileSection } from './ui-profile-sections.js';

/** The character profile reads from the card, linked lore, and live tracker state. */

/** A labelled block: a small caption over its text. */
function block(label, value, className = '') {
    const wrap = document.createElement('div');
    wrap.className = `sillynpc-cv-block ${className}`.trim();

    const caption = document.createElement('div');
    caption.className = 'sillynpc-cv-label';
    caption.textContent = label;

    const body = document.createElement('div');
    body.className = 'sillynpc-cv-value';
    body.textContent = value;

    wrap.append(caption, body);
    return wrap;
}

/** One fact as a chip: a name and its value side by side. */
function chip(name, value) {
    const el = document.createElement('span');
    el.className = 'sillynpc-cv-chip';

    const key = document.createElement('span');
    key.className = 'sillynpc-cv-chip-key';
    key.textContent = name;
    el.append(key);

    if (value !== undefined && value !== null && String(value).trim() !== '') {
        const val = document.createElement('span');
        val.className = 'sillynpc-cv-chip-value';
        val.textContent = String(value);
        el.append(val);
    }
    return el;
}

/** Restore the previous value after a single field is regenerated. */
function buildUndoButton(field, char, input) {
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'sillynpc-profile-undo';
    undo.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
    undo.hidden = true;

    let previous = null;

    undo.addEventListener('click', () => {
        if (previous === null) return;
        char.profile[field.id] = previous;
        input.value = previous;
        saveSettings();
        syncProfileToLore(char).catch(err => console.error(LOG_PREFIX, 'Could not update lorebook profile', err));
        previous = null;
        undo.hidden = true;
    });

    return {
        el: undo,
        /** Offer a way back, unless there was nothing there to lose. */
        offer(replaced) {
            if (!String(replaced ?? '').trim()) return;
            previous = replaced;
            undo.hidden = false;
            undo.title = `Put the previous ${field.label} back.`;
            undo.setAttribute('aria-label', undo.title);
        },
    };
}

/** Edit the active System fields while retaining older saved values below them. */
export function renderProfileFields(char, container) {
    if (!container) return;

    if (!char.profile || typeof char.profile !== 'object') char.profile = {};

    const grid = document.createElement('div');
    grid.className = 'sillynpc-profile-grid';

    for (const field of profileFieldsForCard(char)) {
        const row = document.createElement('div');
        row.className = 'sillynpc-profile-row';

        const label = document.createElement('label');
        label.className = 'sillynpc-profile-label';
        label.textContent = field.label;

        /* Write this one field again, whatever it already says.
         *
         * Fill on its own only ever writes a blank, and must keep doing so - pressing one
         * button should not rewrite a personality somebody sat down and wrote. But there was
         * no deliberate way to redo one either, so the only route was to empty the box by
         * hand first, per field and per character. This is that route, asked for explicitly
         * and one field at a time.
         *
         * The way back is the button beside this one, which appears once there is something
         * to go back to. There is no undo for settings, and a regenerate is worth little if
         * the answer is worse and gone.
         */
        const input = document.createElement('textarea');
        input.rows = 3;
        input.className = 'text_pole sillynpc-profile-input';
        input.placeholder = field.placeholder;
        input.value = String(profileFieldValue(char.profile, field));
        // Saved as typed, with no redraw. Rebuilding the panel mid-sentence is what takes
        // the cursor away, and three of these four are paragraphs.
        input.addEventListener('input', () => {
            char.profile[field.id] = input.value;
            saveSettings();
        });
        input.addEventListener('change', () => syncProfileToLore(char)
            .catch(err => console.error(LOG_PREFIX, 'Could not update lorebook profile', err)));

        label.setAttribute('for', `sillynpc-profile-${field.id}`);
        input.id = `sillynpc-profile-${field.id}`;

        const undo = buildUndoButton(field, char, input);

        const redo = document.createElement('button');
        redo.type = 'button';
        redo.className = 'sillynpc-profile-redo';
        redo.innerHTML = '<i class="fa-solid fa-rotate"></i>';
        redo.title = `Write ${field.label} again from the story, the lore entry and the `
            + 'tracker. Replaces what is there; the button beside this one puts it back.';
        redo.setAttribute('aria-label', redo.title);
        redo.addEventListener('click', async () => {
            if (redo.disabled) return;
            const previous = String(profileFieldValue(char.profile, field));
            redo.disabled = true;
            redo.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            try {
                const result = await fillProfile(char, { fields: [field.id] });
                if (!result.ok) {
                    toastr.error(result.reason || 'That did not work.', 'SillyNPC');
                } else if (!result.filled.length) {
                    toastr.info(result.reason || 'Nothing came back for that field.', 'SillyNPC');
                } else {
                    input.value = String(profileFieldValue(char.profile, field));
                    undo.offer(previous);
                }
            } catch (err) {
                console.error(LOG_PREFIX, 'Regenerating a profile field failed', err);
                toastr.error(String(err?.message || err), 'SillyNPC');
            } finally {
                redo.disabled = false;
                redo.innerHTML = '<i class="fa-solid fa-rotate"></i>';
            }
        });

        const controls = document.createElement('div');
        controls.className = 'sillynpc-profile-controls';
        controls.append(undo.el, redo);

        const labelRow = document.createElement('div');
        labelRow.className = 'sillynpc-profile-label-row';
        // Two children, so space-between means what it says: the name at one end and the
        // buttons together at the other. With three it spread them across the row and left
        // the redo floating in the middle of nothing.
        labelRow.append(label, controls);

        row.append(labelRow, input);
        grid.append(row);
    }

    container.appendChild(grid);

    // Saved fields from an older System remain editable even after that System retires
    // them. Fill uses only active fields.
    const active = new Set(profileFieldsForCard(char).flatMap(field => [field.id, field.legacyId].filter(Boolean)));
    const legacy = Object.entries(char.profile).filter(([id, value]) =>
        !active.has(id) && String(value ?? '').trim());
    if (legacy.length) {
        const heading = document.createElement('label');
        heading.textContent = 'Other / Legacy details';
        container.append(heading);
        for (const [id, value] of legacy) {
            const row = document.createElement('div');
            row.className = 'sillynpc-profile-row';
            const label = document.createElement('label');
            label.textContent = id;
            const input = document.createElement('textarea');
            input.className = 'text_pole sillynpc-profile-input';
            input.rows = 3;
            input.value = String(value);
            input.addEventListener('input', () => {
                char.profile[id] = input.value;
                saveSettings();
            });
            row.append(label, input);
            container.append(row);
        }
    }
}

/**
 * The portrait, or the same placeholder the editor shows when there is none.
 *
 * Deliberately not the editor's portrait block: that one carries four controls, a
 * carousel and a three-way delete, none of which belong on a page that cannot be edited.
 */
function buildPortrait(char) {
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-cv-portrait';

    if (char.imageUrl) {
        const img = document.createElement('img');
        img.src = char.imageUrl;
        img.alt = char.name || '';
        if (char.imageFit) img.style.objectFit = char.imageFit;
        // The same click the editor's preview has. This one is cropped to the column too,
        // and a portrait you cannot see properly is the one thing on the page somebody
        // actually wants to look at.
        img.title = 'Click to view full size';
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => openLightbox(char.imageUrl));
        wrap.append(img);
    } else {
        const empty = document.createElement('div');
        empty.className = 'sillynpc-cv-portrait-empty';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-user-large';
        const text = document.createElement('span');
        text.textContent = 'no image';
        empty.append(icon, text);
        wrap.append(empty);
    }

    if (char.color) {
        const swatch = document.createElement('span');
        swatch.className = 'sillynpc-cv-colour';
        swatch.style.backgroundColor = char.color;
        swatch.title = 'Speech colour';
        wrap.append(swatch);
    }

    return wrap;
}

/**
 * The profile fields as something to read: a row of short ones, then a block each for the
 * paragraphs. Empty fields are left out rather than captioned with nothing under them.
 *
 * Shared by the character page and the player sheet, which show the same four fields and
 * had no reason to draw them differently.
 *
 * @param {object} char Anything carrying a `profile` - a character card or the player's.
 * @param {{ extraBadges?: Element[] }} [options] Chips to ride along in the top row.
 * @returns {Element[]} Empty when nothing is written, so the caller can say so its own way.
 */
export function buildProfileBlocks(char, { extraBadges = [], includeIdentity = true } = {}) {
    const profile = char?.profile || {};
    const fields = profileFieldsForCard(char);
    const written = fields.filter(f => String(profileFieldValue(profile, f)).trim());
    const out = [];

    // Age is one word and sits on a line of its own badly, so the short fields ride
    // together as chips while the paragraphs get a block each.
    const badges = [...written.filter(f => !f.multiline).map(f => chip(f.label, profileFieldValue(profile, f))),
        ...extraBadges];
    if (includeIdentity && badges.length) {
        const identity = document.createElement('div');
        identity.className = 'sillynpc-cv-chips sillynpc-cv-identity';
        identity.append(...badges);
        out.push(identity);
    }

    for (const field of written.filter(f => f.multiline)) {
        out.push(block(field.label, profileFieldValue(profile, field)));
    }
    const active = new Set(fields.flatMap(field => [field.id, field.legacyId].filter(Boolean)));
    const legacy = Object.entries(profile).filter(([id, value]) =>
        !active.has(id) && String(value ?? '').trim());
    if (legacy.length) {
        const section = document.createElement('div');
        section.className = 'sillynpc-cv-block';
        const heading = document.createElement('div');
        heading.className = 'sillynpc-cv-label';
        heading.textContent = 'Other / Legacy details';
        section.append(heading, ...legacy.map(([id, value]) => block(id, String(value))));
        out.push(section);
    }
    return out;
}

/**
 * Renders the read-only view of one character.
 *
 * @param {object} char
 * @param {HTMLElement} container
 * @returns {Promise<void>} Resolves once the lore entry has been read in.
 */
export async function renderProfileView(char, container) {
    if (!container || !char) return;
    const linkedContent = char.lorebook?.world ? await readLoreEntry(char) : '';
    const unified = readLoreValues(linkedContent, char.profile, char.isPlayer ? 'player' : 'npc') || char.profile || {};
    container.replaceChildren();
    container.className = 'sillynpc-charview';

    const body = document.createElement('div');
    body.className = 'sillynpc-cv-body';

    // ── Left: the portrait ──────────────────────────────────────────────────
    const left = document.createElement('div');
    left.className = 'sillynpc-cv-left';
    left.append(buildPortrait(char));

    if (char.category) {
        const cat = document.createElement('div');
        cat.className = 'sillynpc-cv-category';
        cat.textContent = char.category;
        left.append(cat);
    }

    // ── Right: everything that is written down ──────────────────────────────
    const right = document.createElement('div');
    right.className = 'sillynpc-cv-right';

    const aliasNames = (char.aliases || [])
        .filter(a => a?.pattern && !a.isRegex)
        .map(a => a.pattern);
    const identity = document.createElement('div');
    identity.className = 'sillynpc-cv-chips sillynpc-cv-identity';
    identity.append(...profileFieldsForCard(char)
        .filter(field => !field.multiline && String(profileFieldValue(unified, field)).trim())
        .map(field => chip(field.label, profileFieldValue(unified, field))));
    if (aliasNames.length) identity.append(chip('Also called', aliasNames.join(', ')));
    if (identity.childElementCount) left.append(identity);

    const { stats, collections } = liveFactsFor(char);
    const statChips = Object.entries(stats)
        .filter(([, value]) => String(value ?? '').trim() !== '')
        .map(([name, value]) => chip(name, value));
    if (statChips.length) {
        const statsSection = buildProfileSection('stats', 'Stats', { open: true });
        const row = document.createElement('div');
        row.className = 'sillynpc-cv-chips';
        row.append(...statChips);
        statsSection.body.append(row);
        right.append(statsSection.section);
    }
    for (const colDef of getSettings().statusTracker.collections || []) {
        if (!colDef?.id || !Object.hasOwn(collections, colDef.id)) continue;
        const identifier = colDef.fields?.find(field => field.isPrimary)?.name || 'name';
        const items = (collections[colDef.id] || [])
            .map(item => String(item?.[identifier] ?? '').trim()).filter(Boolean);
        const collection = buildProfileSection(`collection:${colDef.id}`, colDef.name || colDef.id,
            { open: true, count: items.length });
        const row = document.createElement('div');
        row.className = 'sillynpc-cv-chips';
        row.append(...items.map(name => chip(name)));
        if (!items.length) row.textContent = 'No entries.';
        collection.body.append(row);
        right.append(collection.section);
    }

    const lore = buildProfileSection('lore', 'Lore');
    const narrative = lore.body;
    narrative.classList.add('sillynpc-cv-narrative');
    right.append(lore.section);
    const blocks = buildProfileBlocks({ ...char, profile: unified }, {
        includeIdentity: false,
    });

    if (blocks.length) {
        narrative.append(...blocks);
    } else {
        const empty = document.createElement('p');
        empty.className = 'notes sillynpc-cv-empty';
        empty.textContent = 'No lore recorded yet. Fill reads the story '
            + 'and writes it, or open Edit and write it yourself.';
        narrative.append(empty);
    }

    renderCharacterMemorySection(char, right);
    body.append(left, right);
    container.append(body);

}
