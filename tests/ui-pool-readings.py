"""Read-only pool parsing and rendering fixtures in the running SillyTavern host."""
import json
import time
from ui_webdriver import browser_session

with browser_session() as browser:
    browser.execute("""
      const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
      const script = document.createElement('script'); script.type = 'module'; script.id = 'pool-readings-smoke';
      script.textContent = `
        const result = {};
        let settings, originalTracker, live, savedLive;
        try {
          const root = ${JSON.stringify(new URL('.', entry.src).href)};
          const { sanitizeModelUpdate, applyUpdate, loadStateFromMetadata } = await import(root + 'src/tracker/status-logic.js');
          const { replaceStatTag } = await import(root + 'src/tracker/ui/status-ui-template-core.js');
          const { constrainNumericStat } = await import(root + 'src/tracker/numeric-stat-bounds.js');
          const { getSettings } = await import(root + 'src/core/settings.js');
          settings = getSettings(); originalTracker = settings.statusTracker;
          live = loadStateFromMetadata(); savedLive = structuredClone(live);
          const hp = { id: 'hp', name: 'HP', type: 'number', defaultValue: '15/15', maxStatValue: '30', format: '{{name}} {{value}}' };
          const level = { id: 'level', name: 'Level', type: 'number', locked: true, defaultValue: '' };
          const xp = { id: 'xp', name: 'XP', type: 'number', defaultValue: '0/20' };
          const template = { id: 'pokemon', statIds: ['hp', 'level', 'xp'], progression: {
            enabled: true, xpFieldId: 'xp', levelFieldId: 'level', pointsPerLevel: 0, assignment: 'random', statIds: [] } };
          const tracker = { ...originalTracker, globalStats: [hp], playerStats: [hp], npcStats: [hp, level, xp], npcTemplates: [template],
            progression: { player: { enabled: false } }, collections: [],
            presets: { ...originalTracker.presets, [settings.activeSystem]: { definition: {
              npcTemplates: [template], stats: { npc: [hp, level, xp] }, profiles: { npc: [] } } } } };
          settings.statusTracker = tracker;
          const state = { global: { HP: '15' }, player: { stats: { HP: '15' } }, characters: [{ name: 'Pool fixture', npcTemplateId: 'pokemon', stats: { HP: '15' } }] };
          const update = { global: { HP: '15/15' }, player: { stats: { HP: '15/15' } }, characters: [{ name: 'Pool fixture', npcTemplateId: 'pokemon', stats: { HP: '15/15' } }] };
          sanitizeModelUpdate(update, state, tracker);
          result.poolAccepted = update.global.HP === '15/15' && update.player.stats.HP === '15/15' && update.characters[0].stats.HP === '15/15';
          result.numericAccepted = constrainNumericStat(hp, update.player.stats.HP, '15') === '15/15';
          const host = document.createElement('div');
          host.innerHTML = replaceStatTag('{{HP}}', hp, update.player.stats.HP, 'player');
          result.rendered = host.textContent === 'HP 15/15';
          result.editable = host.querySelector('.sillynpc-status-editable')?.textContent === '15/15';
          result.fullMeter = host.querySelector('.sillynpc-status-meter-fill')?.style.width === '100%';
          state.player.stats.HP = '10/18';
          const next = { player: { stats: { HP: '9/999' } } };
          sanitizeModelUpdate(next, state, tracker);
          result.liveCapacityPreserved = next.player.stats.HP === '9/18';
          const fixture = { ...savedLive, global: {}, player: { ...savedLive.player, stats: { ...savedLive.player?.stats, HP: '15/15' } }, characters: [
            { name: 'Pool fixture Flarit', npcTemplateId: '', stats: {}, collections: {} },
            { name: 'Pool fixture other', npcTemplateId: '', stats: {}, collections: {} }
          ] };
          for (const key of Object.keys(live)) delete live[key]; Object.assign(live, fixture);
          const initial = { characters: [
            { name: 'Pool fixture Flarit', npcTemplateId: 'pokemon', stats: { HP: '5/5', Level: 1, XP: 0 } },
            { name: 'Pool fixture other', npcTemplateId: 'pokemon', stats: { HP: 8, Level: 3 } }
          ] };
          sanitizeModelUpdate(initial, fixture, tracker);
          result.initialPool = initial.characters[0].stats.HP === '5/5';
          result.initialBarePool = initial.characters[1].stats.HP === '8/8';
          result.initialLockedLevel = initial.characters[0].stats.Level === '1';
          const preview = applyUpdate(initial, { dryRun: true, admitCharacters: true });
          result.initialApplied = preview.characters[0]?.stats.HP === '5/5' && preview.characters[0]?.stats.Level === '1'
            && preview.characters[1]?.stats.HP === '8/8' && preview.characters[1]?.stats.Level === '3';
          const later = { characters: [{ name: 'Pool fixture Flarit', stats: { HP: '4/10', Level: 2 } }] };
          sanitizeModelUpdate(later, preview, tracker);
          result.establishedProtected = later.characters[0].stats.HP === '4/5' && later.characters[0].stats.Level === undefined;
        } catch(error) { result.error = error.stack; }
        finally {
          if (settings && originalTracker) settings.statusTracker = originalTracker;
          if (live && savedLive) { for (const key of Object.keys(live)) delete live[key]; Object.assign(live, savedLive); }
        }
        document.documentElement.setAttribute('data-pool-readings-smoke', JSON.stringify(result));
      `;
      document.body.append(script);
    """)
    try:
        result = None
        for _ in range(60):
            raw = browser.execute("return document.documentElement.getAttribute('data-pool-readings-smoke')")
            if raw:
                result = json.loads(raw)
                break
            time.sleep(.25)
        assert result and all(value is True for value in result.values()), result
        print('SillyNPC pool readings UI passed:', json.dumps(result))
    finally:
        browser.execute("document.querySelector('#pool-readings-smoke')?.remove();document.documentElement.removeAttribute('data-pool-readings-smoke')")
