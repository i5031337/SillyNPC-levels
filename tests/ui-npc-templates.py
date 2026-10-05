"""Read-only SillyTavern System Builder smoke check; requires a running local server."""
import json
import time
from ui_webdriver import browser_session


with browser_session() as browser:
    execute = browser.execute
    execute("""const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
      const script = document.createElement('script'); script.type = 'module'; script.id = 'sillynpc-template-smoke';
      script.textContent = `
        try {
        const root = ${JSON.stringify(new URL('.', entry.src).href)};
        const { getSettings } = await import(root + 'src/core/settings.js');
        const { normalizeSystemDefinition } = await import(root + 'src/core/system-schema.js');
        const { buildSystemBuilder } = await import(root + 'src/ui/system/ui-system-builder.js');
        const { buildCollectionTargetsEditor } = await import(root + 'src/ui/system/ui-collection-targets.js');
        const { playerCollections } = await import(root + 'src/ui/characters/ui-player-sections.js');
        const { collectionAppliesTo } = await import(root + 'src/core/collection-targets.js');
        const { buildCollectionsEditor } = await import(root + 'src/ui/system/ui-system-collections.js');
        const { renderCollectionsSection } = await import(root + 'src/ui/manage/ui-manage-collections.js');
        const { summariseCollections } = await import(root + 'src/tracker/extractor/status-extractor-prompt-state.js');
        const { buildExtractionSchema } = await import(root + 'src/tracker/extractor/status-extractor-schema.js');
        const { buildNpcTemplateSelect } = await import(root + 'src/ui/characters/ui-npc-template.js');
        const { renderProfileFields } = await import(root + 'src/ui/characters/ui-profile.js');
        const { buildStatusHtml } = await import(root + 'src/tracker/ui/status-ui-template.js');
        const { buildUserPrompt } = await import(root + 'src/tracker/extractor/status-extractor-prompt.js');
        const { buildUpdateFromChanges } = await import(root + 'src/tracker/status-diff-review.js');
        const { renderReviewPanel } = await import(root + 'src/ui/tracker/ui-change-review.js');
        const { formatLoreContent, parseLoreContent } = await import(root + 'src/lore/lore-format.js');
        const settings = getSettings();
        const chat = SillyTavern.getContext().chat;
        const savedChat = chat.slice();
        const active = settings.activeSystem;
        const tracker = settings.statusTracker;
        const host = document.createElement('div');
        host.id = 'sillynpc-template-fixture'; document.body.append(host);
        let result;
        try {
          const definition = normalizeSystemDefinition({ schemaVersion: 1, name: 'Fixture',
            profiles: { player: [], npc: [{ id: 'occupation', label: 'Occupation' }, { id: 'species', label: 'Species' }] },
            stats: { world: [], player: [], npc: [
              { id: 'hp', name: 'HP', type: 'number', defaultValue: '10/10' },
              { id: 'friendship', name: 'Friendship', type: 'number', defaultValue: '0' }] },
            collections: [
              { id: 'moves', name: 'Moves', target: 'npc', npcTemplateId: 'pokemon', fields: [{ name: 'name', isPrimary: true }] },
              { id: 'clothes', name: 'Clothing', targets: ['player', 'template:human'], fields: [{ name: 'name', isPrimary: true }] }],
            npcTemplates: [
              { id: 'human', name: 'Human', description: 'Human trainers.', profileIds: ['occupation'], statIds: ['hp'] },
              { id: 'pokemon', name: 'Pokémon', description: 'Pokémon creatures.', profileIds: ['species'], statIds: ['hp', 'friendship'] }] });
          settings.activeSystem = 'Fixture';
          settings.statusTracker = { ...tracker, presets: { Fixture: { definition } }, npcStats: definition.stats.npc, globalStats: [], playerStats: [], collections: definition.collections };
          const collectionsEditor = buildCollectionsEditor(() => {}); host.append(collectionsEditor);
          const edited = { id: 'edited', target: 'all', fields: [] };
          let targetSaves = 0;
          const targetEditor = buildCollectionTargetsEditor(edited, () => { targetSaves++; }); host.append(targetEditor);
          const tick = (value, checked) => {
            const input = [...targetEditor.querySelectorAll('.col-target')].find(input => input.value === value);
            input.checked = checked; input.dispatchEvent(new Event('change'));
          };
          const templateDisabledByAllNpcs = [...targetEditor.querySelectorAll('.col-target')]
              .filter(input => input.value.startsWith('template:')).every(input => input.disabled);
          tick('npc', false); tick('template:human', true);
          tick('npc', true);
          const individualSelectionPreserved = targetEditor.querySelector('[value="template:human"]').checked
              && targetEditor.querySelector('[value="template:human"]').disabled;
          tick('npc', false);
          const individualSelectionRestored = targetEditor.querySelector('[value="template:human"]').checked
              && !targetEditor.querySelector('[value="template:human"]').disabled;
          const savedTargets = normalizeSystemDefinition({ schemaVersion: 1, collections: [edited] }).collections[0].targets;
          const targetRoundtrip = [...buildCollectionTargetsEditor(edited, () => {}).querySelectorAll('.col-target:checked')].map(input => input.value);
          tick('player', false); tick('template:human', false);
          const emptyTargetsDisabled = !collectionAppliesTo(edited, 'player') && !collectionAppliesTo(edited, 'npc', { npcTemplateId: 'human' });
          const builder = buildSystemBuilder(() => {}); host.append(builder);
          [...builder.querySelectorAll('[role=tab]')].find(tab => tab.textContent === 'NPC Templates').click();
          const sections = [...builder.querySelectorAll('.sillynpc-npc-templates details')];
          const human = { name: 'Trainer', npcTemplateId: 'human', profile: {} };
          const pokemon = { name: 'Pikachu', npcTemplateId: 'pokemon', profile: {} };
          const state = { global: {}, player: { name: 'Player', stats: {}, collections: { clothes: [{ name: 'Player jacket' }], moves: [{ name: 'Wrong player move' }] } }, characters: [
            { ...human, stats: { HP: '8/10', Friendship: '99' }, collections: { clothes: [{ name: 'Trainer jacket' }], moves: [{ name: 'Wrong human move' }] } },
            { ...pokemon, stats: { HP: '6/10', Friendship: '50' }, collections: { moves: [{ name: 'Thunderbolt' }], clothes: [{ name: 'Wrong pokemon clothes' }] } }] };
          const humanCollections = document.createElement('div'); const pokemonCollections = document.createElement('div');
          host.append(humanCollections, pokemonCollections);
          renderCollectionsSection(human, humanCollections); renderCollectionsSection(pokemon, pokemonCollections);
          const schema = buildExtractionSchema(settings.statusTracker, { state });
          const selector = buildNpcTemplateSelect(pokemon, () => {}, state); host.append(selector);
          const humanFields = document.createElement('div'); const pokemonFields = document.createElement('div');
          host.append(humanFields, pokemonFields);
          renderProfileFields(human, humanFields); renderProfileFields(pokemon, pokemonFields);
          const box = document.createElement('div');
          box.innerHTML = buildStatusHtml(state, settings.statusTracker); host.append(box);
          const rows = [...box.querySelectorAll('.sillynpc-character-status, .sillynpc-status-char')];
          chat.splice(0, chat.length, { extra: { sillynpc_pending: [{
            scope: 'character', actor: 'Unknown NPC', label: 'NPC template', kind: 'npc-template',
            before: '(unassigned)', after: '', risk: 'risky', reason: 'Choose an NPC template' },
            { scope: 'character', actor: 'Unknown NPC', label: 'Thunderbolt', kind: 'item-add', collectionId: 'moves',
              item: { name: 'Thunderbolt' }, after: 'Thunderbolt' }] } });
          const review = document.createElement('div'); host.append(review); renderReviewPanel(review, 0);
          const reviewSelect = review.querySelector('select.sillynpc-review-to');
          reviewSelect.value = 'pokemon'; reviewSelect.dispatchEvent(new Event('change'));
          const templateToggle = review.querySelector('.kind-npc-template .sillynpc-review-toggle');
          templateToggle.checked = true; templateToggle.dispatchEvent(new Event('change'));
          const reviewCollections = () => [...review.querySelector('.kind-item-add .sillynpc-review-dest-select:last-child').options].map(option => option.value);
          const pokemonReviewCollections = reviewCollections();
          reviewSelect.value = 'human'; reviewSelect.dispatchEvent(new Event('change'));
          const humanReviewCollections = reviewCollections();
          reviewSelect.value = 'pokemon'; reviewSelect.dispatchEvent(new Event('change'));
          const lore = formatLoreContent({ species: 'Pikachu' }, '', undefined, 'npc',
            [{ id: 'species', label: 'Species' }]);
          const reader = buildUserPrompt(state, 'Trainer greets Pikachu.', settings.statusTracker);
          const rebuilt = buildUpdateFromChanges([
            { scope: 'character', actor: 'Saori', kind: 'npc-template', after: 'npc' },
            { scope: 'character', actor: 'Saori', kind: 'stat', label: 'Condition', after: 'Healthy' },
            { scope: 'character', actor: 'Saori', kind: 'stat', label: 'Standing', after: 0 }
          ], { characters: [{ name: 'Saori', stats: {}, collections: {} }] }, settings.statusTracker);
          result = {
            pokemonReviewCollections, humanReviewCollections,
            templateDisabledByAllNpcs, individualSelectionPreserved, individualSelectionRestored,
            savedTargets, targetRoundtrip, targetSaves, emptyTargetsDisabled,
            collectionTargets: [...collectionsEditor.querySelectorAll('.col-targets')].map(group => ({
              selected: [...group.querySelectorAll('.col-target:checked')].map(input => input.value),
              options: [...group.querySelectorAll('.col-target')].map(input => input.value) })),
            playerCollections: playerCollections().map(col => col.id),
            playerReaderCollections: Object.keys(summariseCollections(state.player, 'player', settings.statusTracker)),
            humanCollections: [...humanCollections.querySelectorAll('[data-tab]')].map(tab => tab.dataset.tab),
            pokemonCollections: [...pokemonCollections.querySelectorAll('[data-tab]')].map(tab => tab.dataset.tab),
            humanReaderCollections: Object.keys(summariseCollections(state.characters[0], 'npc', settings.statusTracker)),
            pokemonReaderCollections: Object.keys(summariseCollections(state.characters[1], 'npc', settings.statusTracker)),
            schemaNpcCollections: Object.keys(schema.properties.characters.items.properties.collections.properties),
            schemaPlayerCollections: Object.keys(schema.properties.player.properties.collections.properties),
            requiredItemIdentifier: schema.properties.characters.items.properties.collections.properties.moves.properties.add.items.required,
            trackerCollectionTargets: box.textContent.includes('Thunderbolt') && box.textContent.includes('Trainer jacket') && box.textContent.includes('Player jacket')
              && !box.textContent.includes('Wrong player move') && !box.textContent.includes('Wrong human move') && !box.textContent.includes('Wrong pokemon clothes'),
            readerCollectionTargets: reader.includes('npcTemplateId: pokemon') && reader.includes('npcTemplateId: human'),
            templateWithStats: rebuilt.characters[0].npcTemplateId === 'npc'
              && rebuilt.characters[0].stats.Condition === 'Healthy'
              && rebuilt.characters[0].stats.Standing === '0',
            reviewOptions: [...reviewSelect.options].map(option => option.value),
            reviewSelected: reviewSelect.value,
            loreSelectedOnly: lore === 'Species: Pikachu' && parseLoreContent(lore)?.species === 'Pikachu',
            templates: sections.map(section => section.querySelector('summary').textContent),
            selections: sections.map(section => [...section.querySelectorAll('fieldset:not(.sillynpc-progression-editor) input[type=checkbox]')].map(input => input.checked)),
            selected: selector.querySelector('select').value,
            options: [...selector.querySelectorAll('option')].map(option => option.value),
            humanFields: [...humanFields.querySelectorAll('.sillynpc-profile-label')].map(label => label.textContent.trim()),
            pokemonFields: [...pokemonFields.querySelectorAll('.sillynpc-profile-label')].map(label => label.textContent.trim()),
            readerTemplates: reader.includes('npcTemplateId') && reader.includes('Human trainers.') && reader.includes('Pokémon creatures.'),
            humanHidden: !box.innerHTML.includes('99'), pokemonShown: box.innerHTML.includes('50'),
            box: box.textContent
          };
        } catch (error) { result = { error: error.stack }; }
        finally { settings.activeSystem = active; settings.statusTracker = tracker; chat.splice(0, chat.length, ...savedChat); host.remove(); }
        document.body.setAttribute('data-npc-template-smoke', JSON.stringify(result));
        } catch (error) {
          document.body.setAttribute('data-npc-template-smoke', JSON.stringify({ error: error.stack }));
        }
      `; document.body.append(script);""")
    result = None
    for _ in range(80):
        raw = execute("return document.body.getAttribute('data-npc-template-smoke')")
        if raw:
            result = json.loads(raw)
            break
        time.sleep(0.1)
    execute("document.querySelector('#sillynpc-template-smoke')?.remove(); document.body.removeAttribute('data-npc-template-smoke')")
    assert result and 'error' not in result, result
    assert result['pokemonReviewCollections'] == ['moves'] and result['humanReviewCollections'] == ['clothes'], result
    assert [target['selected'] for target in result['collectionTargets']] == [['template:pokemon'], ['player', 'template:human']], result
    assert all(target['options'] == ['player', 'npc', 'template:human', 'template:pokemon'] for target in result['collectionTargets']), result
    assert result['savedTargets'] == result['targetRoundtrip'] == ['player', 'template:human'], result
    assert result['templateDisabledByAllNpcs'] and result['individualSelectionPreserved'] and result['individualSelectionRestored'], result
    assert result['targetSaves'] == 6 and result['emptyTargetsDisabled'], result
    assert result['playerCollections'] == result['playerReaderCollections'] == ['clothes'], result
    assert result['humanCollections'] == result['humanReaderCollections'] == ['clothes'], result
    assert result['pokemonCollections'] == result['pokemonReaderCollections'] == ['moves'], result
    assert result['requiredItemIdentifier'] == ['name'], result
    assert result['schemaNpcCollections'] == ['moves', 'clothes'] and result['schemaPlayerCollections'] == ['clothes'], result
    assert result['trackerCollectionTargets'] and result['readerCollectionTargets'], result
    assert result['templates'] == ['Human', 'Pokémon'], result
    assert result['selections'] == [[True, False, True, False], [False, True, True, True]], result
    assert result['selected'] == 'pokemon' and result['options'] == ['', 'human', 'pokemon'], result
    assert result['humanFields'] == ['Occupation'] and result['pokemonFields'] == ['Species'], result
    assert result['templateWithStats'], result
    assert result['reviewOptions'] == ['', 'human', 'pokemon'] and result['reviewSelected'] == 'pokemon', result
    assert result['loreSelectedOnly'], result
    assert result['readerTemplates'] and result['humanHidden'] and result['pokemonShown'], result
    print('NPC templates live UI passed:', json.dumps(result))
