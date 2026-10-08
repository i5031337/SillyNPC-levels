"""Read-only progression editor, level-up preview, and review fixtures in SillyTavern."""
import json
import time
from ui_webdriver import browser_session


with browser_session() as browser:
    execute = browser.execute
    execute("""
      const entry = [...document.scripts].find(s => s.src.includes('/SillyNPC-XP/index.js'));
      const script = document.createElement('script'); script.type='module'; script.id='progression-smoke';
      script.textContent = `
        const root = ${JSON.stringify(new URL('.', entry.src).href)};
        const { getSettings } = await import(root + 'src/core/settings.js');
        const { buildProgressionEditor } = await import(root + 'src/ui/system/ui-system-progression.js');
        const settings=getSettings(), saved=settings.statusTracker;
        const host=document.createElement('div'); host.style.width='320px'; document.body.append(host);
        const result={};
        try {
          const stats=[{id:'earned',name:'Experience',type:'number',defaultValue:'0/10'},
            {id:'rank',name:'Rank',type:'number',defaultValue:'1',locked:true,carryOver:false},
            {id:'health',name:'Health',type:'number',defaultValue:'6/10',locked:true}];
          const template={id:'hero',statIds:['earned','rank','health'],progression:{enabled:true,xpFieldId:'earned',levelFieldId:'rank',pointsPerLevel:7,assignment:'random',statIds:['health'],increments:{health:2}}};
          settings.statusTracker={playerStats:structuredClone(stats),npcStats:structuredClone(stats),npcTemplates:[template],progression:{player:structuredClone(template.progression)}};
          const render=(owner)=>{host.replaceChildren(buildProgressionEditor({template:owner,onSave:()=>{},onRefresh:()=>render(owner)}));};
          render();
          result.playerFields=[...host.querySelectorAll('select')].length===3;
          result.playerGrowth=host.querySelector('[aria-label="Skill points per level"]').value==='7' && host.textContent.includes('independently') && [...host.querySelectorAll('input[type=checkbox]')].some(input=>input.checked && input.parentElement.textContent.includes('Health'));
          result.narrowLayout=host.scrollWidth<=host.clientWidth+2;
          render(template);
          const growth=host.querySelector('[aria-label="Point assignment"]'); growth.value='manual'; growth.dispatchEvent(new Event('change'));
          const points=host.querySelector('[aria-label="Skill points per level"]'); points.value='12'; points.dispatchEvent(new Event('change'));
          result.npcPolicy=template.progression.assignment==='manual' && template.progression.pointsPerLevel===12;
          const invalid=host.querySelector('[aria-label="Skill points per level"]'); invalid.value='-1'; invalid.dispatchEvent(new Event('change'));
          result.invalidPoints=invalid.value==='12' && template.progression.pointsPerLevel===12;
          result.npcCarryoverIndependent=settings.statusTracker.npcStats.find(s=>s.id==='rank').carryOver===false;
          const enable=host.querySelector('[aria-label="Enable level progression"]'); enable.checked=false; enable.dispatchEvent(new Event('change'));
          result.disabledControls=!host.querySelector('[aria-label="Point assignment"]') && !!host.querySelector('[aria-label="XP field"]');
        } catch(error) {result.error=error.stack;}
        finally {settings.statusTracker=saved;host.remove();}
        document.documentElement.setAttribute('data-progression-smoke',JSON.stringify(result));
      `;
      document.body.append(script);
    """)
    result = None
    for _ in range(60):
        raw=execute("return document.documentElement.getAttribute('data-progression-smoke')")
        if raw:
            result=json.loads(raw)
            break
        time.sleep(.25)
    execute("document.querySelector('#progression-smoke')?.remove();document.documentElement.removeAttribute('data-progression-smoke')")
    assert result and all(value is True for value in result.values()), result
    print(json.dumps(result))

    # Exercise level-up review after restoring the editor fixture.
    browser.resize(600, 900)
    execute("""const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
      if (!entry) throw new Error('Extension entry script missing');
      const script = document.createElement('script'); script.type = 'module'; script.id = 'sillynpc-level-fixture';
      script.textContent = `
        const result = {};
        let settings, originalTracker, live, savedLive, chat, savedChat, host;
        try {
          const root = ${JSON.stringify(new URL('.', entry.src).href)};
          const { getSettings } = await import(root + 'src/core/settings.js');
          const { loadStateFromMetadata, applyUpdate, getCurrentPersonaKey } = await import(root + 'src/tracker/status-logic.js');
          const { computeStateDiff, buildUpdateFromChanges } = await import(root + 'src/tracker/status-diff.js');
          const { selectLevelGrants, collectLevelTransitions } = await import(root + 'src/tracker/extractor/status-level-grants.js');
          const { prepareGrantReview, materializeGrantRows, selectReviewRows } = await import(root + 'src/tracker/level-grant-review.js');
          const { buildPointAllocation } = await import(root + 'src/ui/tracker/ui-point-allocation.js');
          const { renderReviewPanel } = await import(root + 'src/ui/tracker/ui-change-review.js');
          settings = getSettings(); originalTracker = settings.statusTracker;
          live = loadStateFromMetadata(); savedLive = structuredClone(live);
          chat = SillyTavern.getContext().chat; savedChat = chat.slice();
          const stats = [
            { id: 'xp', name: 'Experience', type: 'number', defaultValue: '0/100' },
            { id: 'level', name: 'Rank', type: 'number', locked: true, defaultValue: '1' },
            { id: 'health', name: 'Health', type: 'bar', defaultValue: '10/10' },
            { id: 'power', name: 'Power', type: 'number', locked: true, defaultValue: '3', maxStatValue: '10' }
          ];
          const progression = { enabled: true, xpFieldId: 'xp', levelFieldId: 'level', pointsPerLevel: 2, assignment: 'random',
            statIds: ['health', 'power'], increments: { health: 1, power: 1 } };
          const templates = [
            { id: 'levels-enabled', name: 'Levels enabled', statIds: stats.map(stat => stat.id), progression },
            { id: 'levels-disabled', name: 'Levels disabled', statIds: stats.map(stat => stat.id), progression: { ...progression, enabled: false } }
          ];
          const collection = { id: 'techniques', targets: ['player', 'npc', 'template:levels-enabled'],
            fields: [{ id: 'title', name: 'title', label: 'Technique', type: 'text', isPrimary: true }],
            levelUpRewards: { enabled: true, mode: 'scheduled', schedule: [{ id: 'dash', level: 2, entry: { title: 'Dash' } }] } };
          const tracker = { ...structuredClone(originalTracker), globalStats: [], playerStats: stats, npcStats: stats,
            npcTemplates: templates, progression: { player: progression }, collections: [collection],
            presets: { ...originalTracker.presets, [settings.activeSystem]: { definition: { npcTemplates: templates, stats: { npc: stats } } } } };
          settings.statusTracker = tracker;
          const readings = { Experience: '90/100', Rank: '1', Health: '6/10', Power: '3/10' };
          const fixture = { ...savedLive, global: {}, player: { ...savedLive.player, name: 'Fixture Player', stats: { ...readings }, collections: {} },
            characters: [
              { id: 'fixture-enabled', name: 'Fixture Enabled NPC', npcTemplateId: 'levels-enabled', stats: { ...readings }, collections: {} },
              { id: 'fixture-disabled', name: 'Fixture Disabled NPC', npcTemplateId: 'levels-disabled', stats: { ...readings }, collections: {} }
            ], recently_deleted: {} };
          for (const key of Object.keys(live)) delete live[key]; Object.assign(live, fixture);
          const parsed = { player: { stats: { Experience: '110/100' } }, characters: [
            { name: 'Fixture Enabled NPC', stats: { Experience: '110/100' } },
            { name: 'Fixture Disabled NPC', stats: { Experience: '95/100' } }
          ] };
          const context = { messageId: 0, swipeId: 0, personaId: getCurrentPersonaKey(),
            system: tracker.presets[settings.activeSystem].definition,
            random: (() => { let n=0; return () => n++ % 2 ? .99 : 0; })(),
            requestExtraction: () => { throw new Error('Unexpected numeric LLM request'); } };
          const preview = applyUpdate(parsed, { dryRun: true });
          result.playerRollover = preview.player.stats.Rank === '2' && preview.player.stats.Experience === '10/100';
          result.npcRollover = preview.characters[0].stats.Rank === '2' && preview.characters[0].stats.Experience === '10/100';
          result.disabledUnchanged = preview.characters[1].stats.Rank === '1' && preview.characters[1].stats.Experience === '95/100';
          result.dryRunPure = live.player.stats.Rank === '1' && live.characters[0].stats.Rank === '1';
          const selection = await selectLevelGrants(parsed, fixture, tracker, '', [], context);
          const transitions = collectLevelTransitions(parsed, fixture, tracker, context);
          result.grantCounts = selection.rows.length === 4 && selection.failures.length === 0
            && !selection.rows.some(row => row.actor === 'Fixture Disabled NPC');
          const pending = computeStateDiff(fixture, preview, tracker).filter(row => row.actor !== 'Fixture Disabled NPC');
          prepareGrantReview([], pending, transitions); pending.push(...selection.rows);
          chat.splice(0, chat.length, { mes: 'Fixture level-up', swipe_id: 0, extra: { sillynpc_pending: pending } });
          host = document.createElement('div'); host.style.width = '280px'; host.style.position = 'fixed'; host.style.left = '0'; host.style.top = '0';
          document.body.append(host); renderReviewPanel(host, 0);
          const panel = host.querySelector('.sillynpc-review-panel');
          result.reviewRecipients = panel.textContent.includes('You') && panel.textContent.includes('Fixture Enabled NPC')
            && !panel.textContent.includes('Fixture Disabled NPC');
          result.reviewRewards = [...panel.querySelectorAll('.kind-item-add')].length === 2
            && panel.querySelectorAll('.sillynpc-point-allocation').length === 2
            && [...panel.querySelectorAll('.sillynpc-point-allocation span')].every(el => el.textContent === '+1');
          const dependencies = [...panel.querySelectorAll('.sillynpc-review-row')].filter(el =>
            ['Experience', 'Rank'].includes(el.querySelector('.sillynpc-review-label')?.textContent));
          const firstToggle = dependencies[0].querySelector('input[type=checkbox]');
          firstToggle.focus(); result.keyboard = document.activeElement === firstToggle;
          firstToggle.click();
          result.dependencies = [...panel.querySelectorAll('.sillynpc-review-toggle:disabled')].length === 2;
          firstToggle.click();
          result.dependenciesRestored = panel.querySelectorAll('.sillynpc-review-toggle:disabled').length === 0;
          result.narrowLayout = host.scrollWidth <= host.clientWidth + 2;
          const applied = materializeGrantRows(selection.rows, preview, tracker, [], {
            acceptedTransitionIds: transitions.map(t => t.transitionId), personaId: getCurrentPersonaKey() });
          result.acceptanceMath = applied.rows.filter(row => row.label === 'Health' && row.kind === 'stat').every(row => row.grant.valueAfter === '7/11');
          const confirmed = applyUpdate(buildUpdateFromChanges(applied.rows, preview, tracker), {
            dryRun: true, progressionResolved: true });
          result.confirmedRatings = confirmed.player.stats.Power === '4/10'
            && confirmed.characters[0].stats.Power === '4/10'
            && confirmed.characters[0].stats.Health === '7/11';
          const manual = selection.rows.find(row => row.kind === 'stat-points' && row.scope === 'player');
          const model = { change: { ...manual, allocations: {}, grant: { ...manual.grant, assignment: 'manual' } } };
          const widget = buildPointAllocation(model); host.append(widget);
          const hp = widget.querySelector('[aria-label="Health skill points"]');
          const power = widget.querySelector('[aria-label="Power skill points"]');
          hp.value='2'; hp.dispatchEvent(new Event('input'));
          power.value='1'; power.dispatchEvent(new Event('input'));
          result.manualBudget = model.allocations.health===2 && !model.allocations.power
            && widget.textContent.includes('0 of 2 points remaining');
          hp.value='1'; hp.dispatchEvent(new Event('input'));
          const partial = materializeGrantRows([{...model.change, allocations:model.allocations}], preview, tracker, [], {
            acceptedTransitionIds: transitions.map(t => t.transitionId), personaId: getCurrentPersonaKey() });
          result.manualRemainder = partial.remaining[0].grant.points===1
            && partial.rows.find(row=>row.kind==='stat').grant.valueAfter==='7/11';
          result.rejectedXpBlocks = selectReviewRows(pending, selection.rows).rows.length === 0;
        } catch (error) { result.error = String(error); result.stack = error.stack; }
        finally {
          host?.remove();
          if (chat && savedChat) chat.splice(0, chat.length, ...savedChat);
          if (live && savedLive) { for (const key of Object.keys(live)) delete live[key]; Object.assign(live, savedLive); }
          if (settings && originalTracker) settings.statusTracker = originalTracker;
        }
        document.documentElement.setAttribute('data-level-fixture', JSON.stringify(result));
      `;
      document.head.appendChild(script);""")
    result = None
    for _ in range(100):
        raw = execute("return document.documentElement.getAttribute('data-level-fixture')")
        if raw:
            result = json.loads(raw)
            break
        time.sleep(0.25)
    execute("document.querySelector('#sillynpc-level-fixture')?.remove(); document.documentElement.removeAttribute('data-level-fixture');")
    expected = ['playerRollover', 'npcRollover', 'disabledUnchanged', 'dryRunPure', 'grantCounts', 'reviewRecipients',
                'reviewRewards', 'keyboard', 'dependencies', 'dependenciesRestored', 'narrowLayout', 'acceptanceMath', 'confirmedRatings', 'manualBudget', 'manualRemainder', 'rejectedXpBlocks']
    assert result and all(result.get(key) for key in expected), result
    print('SillyNPC level rewards UI passed:', json.dumps(result))
