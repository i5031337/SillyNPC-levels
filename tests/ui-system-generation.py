"""Read-only SillyTavern System Builder smoke check; requires a running local server."""
import json
import time
from ui_webdriver import browser_session


with browser_session() as browser:
    execute = browser.execute
    execute("document.querySelector('#sillynpc-open-manage').click()")
    time.sleep(0.5)
    execute("[...document.querySelectorAll('.sillynpc-tab')].find(el => el.textContent.trim() === 'Systems').click()")
    execute("document.querySelector('#sillynpc-systems-view [data-view=manager]').click()")
    real = execute("""const button = [...document.querySelectorAll('button')].find(el => el.textContent === 'Generate from premise');
        button.click();
        const panel = document.querySelector('.sillynpc-system-generation');
        const result = { opened: !!panel, disabled: panel.querySelector('.gen-save').disabled,
          connection: !!panel.querySelector('.gen-connection'), labeled: !!panel.querySelector('.gen-premise[aria-label]') };
        panel.querySelector('.gen-cancel').click(); return result;""")
    assert all(real.values()), real
    execute("""const entry = [...document.scripts].find(script => script.src.includes('/SillyNPC-XP/index.js'));
        const script = document.createElement('script'); script.type = 'module'; script.id = 'sillynpc-generation-smoke';
        script.textContent = `
          const root = ${JSON.stringify(new URL('.', entry.src).href)};
          const { buildSystemGeneration, saveGeneratedSystem } = await import(root + 'src/ui/system/ui-system-generation.js');
          const { getSettings } = await import(root + 'src/core/settings.js');
          const { allocatePlan } = await import(root + 'src/generation/plan.js');
          const { plan, responseFor } = await import(root + 'tests/system-generation-fixture.mjs');
          const registry = allocatePlan(plan);
          const before = JSON.stringify(getSettings());
          const host = SillyTavern.getContext();
          const metadata = JSON.stringify(host.chatMetadata);
          const chat = JSON.stringify(host.chat);
          const results = {};
          const wait = async predicate => {
            for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
            throw new Error('Smoke timeout');
          };
          const mount = panel => { panel.style.width = '280px'; document.body.append(panel); return panel; };
          const input = (el, value, event = 'input') => { el.value = value; el.dispatchEvent(new Event(event, { bubbles: true })); };
          let panel, second, third;
          try {
            let fail = true, calls = [], saved;
            panel = mount(buildSystemGeneration(() => {}, {
              requestFactory: () => async args => {
                calls.push(args.stage);
                if (fail && args.stage === 'stats.npc') return '{truncated';
                return responseFor(args.stage, registry);
              },
              save: (definition, name) => {
                saved = JSON.parse(JSON.stringify(definition));
                return saveGeneratedSystem(definition, name, { presets: {}, save: text => JSON.parse(text) });
              }
            }));
            input(panel.querySelector('.gen-premise'), 'Catch monsters during an expedition.');
            panel.querySelector('.gen-generate').click();
            await wait(() => !panel.querySelector('.gen-retry').hidden);
            results.failedSection = panel.querySelector('.gen-save').disabled && panel.querySelector('.gen-errors').textContent.includes('truncated')
              && calls.filter(stage => stage === 'stats.npc').length === 2;
            fail = false; panel.querySelector('.gen-retry').click();
            await wait(() => !panel.querySelector('.gen-save').disabled);
            results.preserved = calls.filter(stage => stage === 'stats.player').length === 1;
            results.fewerCalls = !calls.some(stage => stage.startsWith('template.') || stage.startsWith('progression.') || stage === 'presentation')
              && calls.length === 10 && panel.querySelector('.gen-progress').textContent.includes('10 requests');
            results.summary = panel.querySelector('.gen-summary').textContent.includes('Creature')
              && panel.querySelector('.gen-summary').textContent.includes('scheduled');
            panel.querySelector('.gen-edit').click();
            const tab = text => [...panel.querySelectorAll('[role=tab]')].find(el => el.textContent === text).click();
            tab('Player Stats');
            const energy = [...panel.querySelectorAll('.sillynpc-alias-row')].find(row => row.querySelector('.stat-name')?.value === 'Energy');
            input(energy.querySelector('.stat-name'), 'Focus', 'change');
            input(energy.querySelector('.stat-min'), '20');
            results.validation = panel.querySelector('.gen-save').disabled && panel.querySelector('.gen-errors').textContent.includes('bounds');
            input(energy.querySelector('.stat-min'), '0');
            results.validAgain = !panel.querySelector('.gen-save').disabled;
            tab('NPC Templates');
            input(panel.querySelector('.sillynpc-npc-templates textarea'), 'Catchable monsters encountered in the wild.', 'change');
            tab('NPC Profile');
            input(panel.querySelector('.profile-guidance'), 'Describe the species clearly.');
            tab('Collections');
            input(panel.querySelector('.col-hint'), 'Learned combat techniques.');
            input(panel.querySelector('.f-hint'), 'The unique technique name.');
            const primary = panel.querySelector('.f-name'); input(primary, 'title', 'change');
            results.rewardRenameStable = !panel.querySelector('.gen-save').disabled;
            tab('NPC Templates');
            input(panel.querySelector('input[aria-label="New NPC template name"]'), 'Human');
            [...panel.querySelectorAll('button')].find(button => button.textContent === 'Add template').click();
            results.newTemplateValid = !panel.querySelector('.gen-save').disabled && !panel.querySelector('.gen-errors').textContent;
            results.narrow = panel.scrollWidth <= panel.clientWidth + 2;
            panel.querySelector('.gen-save').click();
            results.savedDraft = saved.stats.player.some(f => f.name === 'Focus')
              && saved.npcTemplates[0].description === 'Catchable monsters encountered in the wild.'
              && saved.profiles.npc[0].guidance === 'Describe the species clearly.'
              && saved.collections[0].guidance === 'Learned combat techniques.'
              && saved.collections[0].fields[0].guidance === 'The unique technique name.'
              && saved.collections[0].fields[0].name === 'title'
              && saved.npcTemplates.some(template => template.name === 'Human' && template.progression.enabled === false)
              && saved.collections[0].levelUpRewards.schedule[0].entry.name === 'Quick Strike';
            let collision = false;
            try { saveGeneratedSystem(saved, 'Expedition', { presets: { Expedition: {} }, save: () => { throw new Error('Should not save'); } }); }
            catch (error) { collision = error.message.includes('already exists'); }
            results.collision = collision;
            panel.querySelector('.gen-cancel').click();
            let resolveLate;
            second = mount(buildSystemGeneration(() => {}, { requestFactory: () => async args => {
                if (args.stage === 'stats.world') return new Promise(resolve => { resolveLate = resolve; });
                return responseFor(args.stage, registry);
            } }));
            input(second.querySelector('.gen-premise'), 'Monsters'); second.querySelector('.gen-generate').click();
            await wait(() => !!resolveLate);
            second.querySelector('.gen-cancel').click();
            third = mount(buildSystemGeneration(() => {}, { requestFactory: () => async args => {
              const output = responseFor(args.stage, registry);
              if (args.stage === 'stats.player') {
                const xp = output.section.fields.find(field => field.id === 'xp');
                xp.defaultValue = '0'; xp.maxStatValue = '';
              }
              return output;
            } }));
            input(third.querySelector('.gen-premise'), 'Monster trainer'); third.querySelector('.gen-generate').click();
            await wait(() => !third.querySelector('.gen-retry').hidden);
            results.pendingProgression = third.querySelector('.gen-summary').textContent.includes('Player progression: pending')
              && third.querySelector('.gen-errors').textContent.includes('XP field xp');
            third.querySelector('.gen-cancel').click();
            await wait(() => second.querySelector('.gen-progress').textContent.includes('cancelled'));
            resolveLate(responseFor('stats.world', registry)); await new Promise(resolve => setTimeout(resolve, 40));
            results.cancelled = second.querySelector('.gen-save').disabled && second.querySelector('.gen-summary').textContent.indexOf('Draft ready') < 0;
            second.querySelector('.gen-cancel').click();
            results.settingsIntact = before === JSON.stringify(getSettings());
            results.metadataIntact = metadata === JSON.stringify(host.chatMetadata);
            results.chatIntact = chat === JSON.stringify(host.chat);
          } catch (error) { results.error = String(error) + ' ' + error.stack; }
          finally { panel?.remove(); second?.remove(); third?.remove(); }
          document.documentElement.setAttribute('data-generation-smoke', JSON.stringify(results));
        `;
        document.head.append(script);""")
    result = None
    for _ in range(100):
        raw = execute("return document.documentElement.getAttribute('data-generation-smoke')")
        if raw:
            result = json.loads(raw)
            break
        time.sleep(0.2)
    execute("document.querySelector('#sillynpc-generation-smoke')?.remove(); document.documentElement.removeAttribute('data-generation-smoke');")
    assert result and all(value is True for value in result.values()), result
    print('SillyNPC generator UI passed:', json.dumps(result))
