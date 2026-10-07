export const plan = {
    memories: { enabled: true, guidance: 'Remember consequential battles and commitments; skip routine travel.', interval: 8, maxEntriesPerCharacter: 50 },
    name: 'Expedition', description: 'Catch monsters and learn techniques.', rationale: 'Small persistent ratings and expandable resource pools.',
    profiles: { player: [{ name: 'Background', purpose: 'Training history' }], npc: [{ name: 'Species', purpose: 'Stable visible species' }] },
    stats: { world: [{ name: 'Location', purpose: 'Current region' }],
        player: [{ name: 'XP', purpose: 'Earned training XP' }, { name: 'Level', purpose: 'Training level' }, { name: 'Energy', purpose: 'Spent on expeditions' }],
        npc: [{ name: 'XP', purpose: 'Earned combat XP' }, { name: 'Level', purpose: 'Learned level' }, { name: 'Vigor', purpose: 'Combat stamina' }] },
    playerProgression: { enabled: true, xp: 'XP', level: 'Level', growth: 'All selected stats gain small increases; resources reset.' },
    npcTemplates: [{ name: 'Creature', description: 'Catchable monsters.', profiles: ['Species'], stats: ['XP', 'Level', 'Vigor'],
        progression: { enabled: true, xp: 'XP', level: 'Level', growth: 'All selected stats grow; Level persists.' } }],
    collections: [{ name: 'Techniques', purpose: 'Learned combat actions', targets: ['player', 'Creature'],
        fields: [{ name: 'Name', purpose: 'Technique identifier' }, { name: 'Power', purpose: 'Personal proficiency' }], rewards: 'scheduled' }],
};
export function responseFor(stage, registry) {
    if (stage === 'plan') return { section: structuredClone(plan), assumptions: [] };
    let section;
    const [kind, scope] = stage.split('.');
    if (kind === 'profiles') section = registry.profiles[scope].map(f => ({ id: f.id, label: f.name, guidance: f.purpose, policy: 'anchored' }));
    if (kind === 'stats') section = registry.stats[scope].map(f => ({ id: f.id, name: f.name, purpose: f.purpose,
        type: f.id === 'location' ? 'text' : 'number', defaultValue: f.id === 'location' ? '' : f.id === 'xp' ? '0/100' : f.id === 'level' ? '1' : '6/10',
        locked: f.id === 'level', ...(scope === 'npc' ? { carryOver: ['xp', 'level'].includes(f.id) } : {}), min: f.id === 'location' ? '' : '0', maxStatValue: f.id === 'xp' ? '100' : '' }));
    if (kind === 'stats') {
        const owners = scope === 'player' ? [{ id: 'player', progression: registry.playerProgression }]
            : scope === 'npc' ? registry.npcTemplates : [];
        const enabled = owners.filter(owner => owner.progression.enabled);
        if (enabled.length) section = { fields: section, progression: Object.fromEntries(enabled.map(owner => {
            const config = owner.progression;
            const candidates = section.filter(field => field.type === 'number' && (!owner.statIds || owner.statIds.includes(field.id))
                && ![config.xpFieldId, config.levelFieldId].includes(field.id)).map(field => field.id);
            return [owner.id, { enabled: true, xpFieldId: config.xpFieldId, levelFieldId: config.levelFieldId,
                statGrowth: candidates.length ? 'all' : 'none', statIds: candidates }];
        })) };
    }
    if (kind === 'collection') {
        const c = registry.collections.find(c => c.id === scope);
        section = { id: c.id, name: c.name, targets: c.targets, guidance: c.purpose, fields: c.fields.map((f, index) => ({
            id: f.id, name: f.id, label: f.name, type: index ? 'number' : 'text', defaultValue: index ? 1 : '',
            isPrimary: index === 0, isStatic: index === 0, ...(index ? { min: '1', maxStatValue: '3' } : {}) })) };
    }
    if (kind === 'rewards') section = { enabled: true, mode: 'scheduled', guidance: 'Learn at training milestones.', interval: 1,
        schedule: [{ id: 'reward-2', level: 2, entry: { name: 'Quick Strike', power: 2 } }, { id: 'reward-3', level: 3, entry: { name: 'Guard', power: 1 } }] };
    if (section === undefined) throw new Error(`Unexpected model task: ${stage}`);
    return { section, assumptions: [] };
}
