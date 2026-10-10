import { getContext } from '../../../../../../st-context.js';
import { getSettings, saveSettings } from '../../core/settings.js';
import { LOG_PREFIX } from '../../core/constants.js';
import { profileFieldValue, profileFieldsForCard } from '../../core/profile-fields.js';
import { createCharacter } from '../../characters/characters.js';
import { findCharacterRecord } from '../../characters/character-repository.js';
import { findCardForName, loadStateFromMetadata, mayJoinScene, resolveCanonicalName } from '../status-logic.js';
import { generateLoreContent } from '../../api/api-lore-generate.js';
import { parseGeneratedProfileFields } from '../../lore/lore-format.js';
import { syncProfileToLore } from '../../lore/lore-sync.js';
import { generateCharacterImageLogic } from '../../api/api-image-generate.js';
import { triggerReprocess } from '../../chat/reprocess.js';

/** Generate once for newly discovered, admitted NPCs. Cards keep failed attempts editable. */
export async function generateNewNpcProfiles(names, isCurrent) {
    const result = { generated: 0, failed: 0 };
    if (getSettings().statusTracker.autoGenerateNpcProfiles !== true
        || getContext()?.getCurrentChatId?.() === undefined) return result;
    const seen = new Set();
    for (const rawName of names) {
        if (!isCurrent() || getSettings().statusTracker.autoGenerateNpcProfiles !== true) break;
        const name = resolveCanonicalName(rawName);
        const key = name.toLowerCase();
        const state = loadStateFromMetadata();
        const actor = state.characters.find(actor => actor.name.toLowerCase() === key);
        if (!name || seen.has(key) || !actor || !mayJoinScene(name)
            || key === String(state.player?.name || '').toLowerCase() || findCardForName(name)) continue;
        seen.add(key);
        const fields = profileFieldsForCard(actor);
        if (!fields.length) continue;
        const card = createCharacter(name);
        card.npcTemplateId = actor.npcTemplateId || '';
        card.statusOverrides = structuredClone(actor.stats || {});
        card.statusCollections = structuredClone(actor.collections || {});
        saveSettings();
        const system = getSettings().activeSystem;
        const fieldSignature = JSON.stringify(fields);
        // Discard a response if its reply, chat, card or configured fields changed.
        const canSave = () => isCurrent() && findCharacterRecord(card.id) === card
            && getSettings().statusTracker.autoGenerateNpcProfiles === true
            && getSettings().activeSystem === system
            && JSON.stringify(profileFieldsForCard(card)) === fieldSignature;
        try {
            const { content } = await generateLoreContent(card);
            if (!canSave()) break;
            const values = parseGeneratedProfileFields(content, 'npc');
            if (!values || !fields.some(field => String(values[field.id] || '').trim())) {
                throw new Error('The lore writer returned no usable profile fields.');
            }
            // A manual edit made during generation takes precedence.
            card.profile ||= {};
            for (const field of fields) {
                if (!String(profileFieldValue(card.profile, field)).trim() && values[field.id]) {
                    card.profile[field.id] = values[field.id];
                }
            }
            saveSettings();
            await syncProfileToLore(card, undefined, { isCurrent: canSave });
            if (!canSave()) break;
            result.generated++;
            triggerReprocess();
            if (getSettings().autoPortraitOnFill !== false && !card.imageUrl) {
                try {
                    const imageUrl = await generateCharacterImageLogic(card);
                    // Preserve a portrait selected manually while the request was running.
                    if (!canSave()) break;
                    if (getSettings().autoPortraitOnFill === false) continue;
                    card.images ||= [];
                    if (!card.images.includes(imageUrl)) card.images.push(imageUrl);
                    if (!card.imageUrl) card.imageUrl = imageUrl;
                    saveSettings();
                    triggerReprocess();
                } catch (error) {
                    if (!canSave()) break;
                    console.warn(LOG_PREFIX, `Could not generate ${name}'s portrait`, error);
                    if (typeof toastr !== 'undefined') toastr.warning(
                        `${name}'s profile was saved, but portrait generation failed: ${error.message || error}. Retry from the character sheet.`,
                        'SillyNPC',
                    );
                }
            }
        } catch (error) {
            if (!canSave()) break;
            result.failed++;
            console.warn(LOG_PREFIX, `Could not generate ${name}'s profile`, error);
            if (typeof toastr !== 'undefined') toastr.warning(
                `Could not generate ${name}'s profile: ${error.message || error}. Retry with Fill on the character sheet.`,
                'SillyNPC',
            );
        }
    }
    return result;
}
