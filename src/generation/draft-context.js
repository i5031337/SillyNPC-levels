import { normalizeSystemDefinition } from '../core/system-schema.js';
/** An isolated projection for existing Builder controls. Never swaps the live settings. */
export function createDraftContext(source, onChange = () => {}) {
    const definition = structuredClone(source);
    const tracker = {
        globalStats: structuredClone(definition.stats.world), playerStats: structuredClone(definition.stats.player),
        npcStats: structuredClone(definition.stats.npc), collections: structuredClone(definition.collections),
        progression: structuredClone(definition.progression), npcTemplates: definition.npcTemplates,
    };
    for (const list of [tracker.globalStats, tracker.playerStats, tracker.npcStats]) for (const field of list) field.hint = field.guidance || '';
    for (const col of tracker.collections) { col.hint = col.guidance || ''; for (const field of col.fields) field.hint = field.guidance || ''; }
    const settings = { activeSystem: 'draft', statusTracker: { ...tracker, presets: { draft: { definition } } } };
    const state = settings.statusTracker;
    const context = {
        getSettings: () => settings, definition: () => definition, bulkBars: new Map(),
        saveSettings: () => onChange(context.capture()), updateHUD: () => {},
        renameStat: () => ({}), renameCollectionId: () => 0, renameCollectionField: () => 0,
        capture: () => {
            const field = ({ hint, ...rest }) => ({ ...rest, guidance: hint ?? rest.guidance ?? '' });
            const stats = { world: state.globalStats.map(field), player: state.playerStats.map(field), npc: state.npcStats.map(field) };
            const collections = state.collections.map(({ hint, visible, ...col }) => ({ ...col, guidance: hint ?? col.guidance ?? '', fields: col.fields.map(field) }));
            // Allocate only newly added IDs; semantic errors remain visible to strict validation.
            const candidate = { ...definition, stats, collections, progression: state.progression };
            const allocated = normalizeSystemDefinition(candidate);
            for (const scope of ['world', 'player', 'npc']) stats[scope].forEach((s, i) => { s.id ||= allocated.stats[scope][i].id; });
            collections.forEach((col, i) => col.fields.forEach((f, n) => { f.id ||= allocated.collections[i].fields[n].id; }));
            const hud = { ...definition.hud, playerStatIds: stats.player.filter(s => s.isPrimary).map(s => s.id),
                npcStatIds: definition.hud.npcStatIds.filter(id => stats.npc.some(s => s.id === id)),
                worldStatIds: definition.hud.worldStatIds.filter(id => stats.world.some(s => s.id === id)) };
            return structuredClone({ ...candidate, hud });
        },
    };
    return context;
}
