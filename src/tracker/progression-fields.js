import { resolveProgressionConfig, progressionFieldId } from '../core/progression-config.js';
import { npcTemplateFor } from '../core/npc-templates.js';

/** Resolve configured IDs to the same live definitions used by actor sheets. */
export function progressionFields(settings, { isPlayer = false, actor } = {}) {
    const config = resolveProgressionConfig(settings, { isPlayer,
        templateId: actor?.npcTemplateId, template: isPlayer ? undefined : npcTemplateFor(actor) });
    const definitions = isPlayer ? settings?.playerStats || [] : settings?.npcStats || [];
    const nameOf = id => definitions.find(stat => progressionFieldId(stat) === id)?.name;
    return { ...config, xpName: nameOf(config.xpFieldId), levelName: nameOf(config.levelFieldId) };
}
