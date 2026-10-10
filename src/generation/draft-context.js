import { normalizeSystemDefinition } from '../core/system-schema.js';
import { systemStatFields } from '../core/system-fields.js';
/** An isolated draft for Builder controls. Never swaps the live settings. */
export function createDraftContext(source, onChange = () => {}) {
    const definition = structuredClone(source);
    const tracker = {
        globalStats: definition.stats.world, characterStats: definition.stats.character,
        playerStats: systemStatFields(definition, 'player'), npcStats: systemStatFields(definition, 'npc'),
        collections: structuredClone(definition.collections), progression: definition.progression, npcTemplates: definition.npcTemplates,
    };
    for (const list of [tracker.globalStats, tracker.characterStats]) for (const field of list) field.hint = field.guidance || '';
    for (const col of tracker.collections) { col.hint = col.guidance || ''; for (const field of col.fields) field.hint = field.guidance || ''; }
    const settings = { activeSystem: 'draft', statusTracker: { ...tracker, presets: { draft: { definition } } } };
    const state = settings.statusTracker;
    const context = {
        getSettings: () => settings, definition: () => definition, bulkBars: new Map(),
        saveSettings: () => onChange(context.capture()), updateHUD: () => {},
        renameStat: () => ({}), renameCollectionId: () => 0, renameCollectionField: () => 0,
        capture: () => {
            const field = ({ hint, ...rest }) => ({ ...rest, guidance: hint ?? rest.guidance ?? '' });
            const stats = { world: definition.stats.world.map(field), character: definition.stats.character.map(field) };
            const collections = state.collections.map(({ hint, visible, ...col }) => ({ ...col, guidance: hint ?? col.guidance ?? '', fields: col.fields.map(field) }));
            const candidate = { ...definition, stats, collections };
            const allocated = normalizeSystemDefinition(candidate);
            for (const scope of ['world', 'character']) stats[scope].forEach((s, i) => { s.id ||= allocated.stats[scope][i].id; });
            collections.forEach((col, i) => col.fields.forEach((f, n) => { f.id ||= allocated.collections[i].fields[n].id; }));
            const hud = { ...definition.hud,
                playerStatIds: systemStatFields(candidate, 'player').filter(s => s.isPrimary).map(s => s.id),
                npcStatIds: definition.hud.npcStatIds.filter(id => systemStatFields(candidate, 'npc').some(s => s.id === id)),
                worldStatIds: definition.hud.worldStatIds.filter(id => stats.world.some(s => s.id === id)) };
            return structuredClone({ ...candidate, hud });
        },
    };
    return context;
}
