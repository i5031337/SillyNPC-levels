"""Shared Cast layout with isolated settings; no saves or model requests."""
import json
import time
from ui_webdriver import browser_session

with browser_session() as browser:
    browser.execute(r"""
      const entry = [...document.scripts].find(s => s.src.includes('/SillyNPC-XP/index.js'));
      if (!entry) throw Error('Extension entry missing');
      const script = document.createElement('script'); script.type = 'module'; script.id = 'sillynpc-cast-fixture';
      script.textContent = `
        const root = ${JSON.stringify(new URL('.', entry.src).href)};
        const { profileFieldValue } = await import(root + 'src/core/profile-fields.js');
        let settings;
        const host = document.createElement('div'); host.style.width = '700px'; document.body.append(host);
        const result = {};
        try {
          const definition = { schemaVersion:2, stats: {world:[],character:[{id:'hp',name:'Health',type:'number',defaultValue:'20',targets:['player','npc']}]},
            profiles: [{id:'bio',label:'Biography',multiline:true,targets:['player','npc']},
              {id:'mood',label:'Mood',multiline:false,targets:['player','npc']}],
            npcTemplates:[{id:'cast',name:'Cast'}], memories:{} };
          settings = {activeSystem:'cast-fixture', statusTracker:{playerStats:definition.stats.character, npcStats:definition.stats.character,
            collections:[], presets:{'cast-fixture':{definition}}}};
          const fixtureState = {player:{stats:{Health:'20'},collections:{}},characters:[]};
          // Keep host loaders and writers outside the fixture while exercising the actual renderer code.
          const compile = async (path, names, overrides) => {
            const url = root+path, source=await(await fetch(url)).text(), deps={};
            for (const match of source.matchAll(/import\\s*{([^}]+)}\\s*from\\s*['"]([^'"]+)['"];?/g)) {
              const module=await import(new URL(match[2],url));
              for(const name of match[1].split(',').map(name=>name.trim()).filter(Boolean)) deps[name]=module[name];
            }
            Object.assign(deps,overrides);
            const body=source.replace(/^import\\s+[\\s\\S]*?\\s+from\\s+['"][^'"]+['"];\\s*/gm,'')
              .replaceAll('export async function ','async function ').replaceAll('export function ','function ');
            return new Function(...Object.keys(deps),body+';return {'+names.join(',')+'};')(...Object.values(deps));
          };
          let fixtureChatId='cast-fixture-chat', fixturePersona='cast-persona';
          const fixtureMetadata={};
          const fixtureContext=()=>({chatMetadata:fixtureMetadata,getCurrentChatId:()=>fixtureChatId});
          const common={getContext:fixtureContext,getCurrentPersonaKey:()=>fixturePersona,getSettings:()=>settings,saveSettings:()=>{throw Error('Unexpected host save');},
            loadStateFromMetadata:()=>fixtureState, saveStateToMetadata:()=>{throw Error('Unexpected state save');},
            profileFieldsForCard:()=>definition.profiles};
          const {renderCharacterMemorySection}=await compile('src/ui/characters/ui-character-memory-section.js',['renderCharacterMemorySection'],common);
          const {renderProfileView,renderProfileFields}=await compile('src/ui/characters/ui-profile.js',['renderProfileView','renderProfileFields'],{...common,
            liveFactsFor:()=>({stats:{Health:'20'},collections:{}}),renderCharacterMemorySection});
          const {renderOverridesSection}=await compile('src/ui/manage/ui-manage-overrides.js',['renderOverridesSection'],{
            ...common,npcStatsFor:()=>definition.stats.character});
          const {renderCollectionsSection}=await compile('src/ui/manage/ui-manage-collections.js',['renderCollectionsSection'],common);
          const {buildManualLevelUpSection:manualSection}=await import(root+'src/ui/characters/ui-manual-level-up.js');
          const {renderCharacterEditor}=await compile('src/ui/manage/ui-manage-editor.js',['renderCharacterEditor'],{
            ...common,renderProfileView,renderProfileFields,renderOverridesSection,renderCollectionsSection,renderCharacterMemorySection,
            buildNpcTemplateSelect:()=>document.createElement('select'),
            buildManualLevelUpSection:card=>manualSection(card,{service:{info:()=>({enabled:false}),isBusy:()=>false,records:()=>[]}})});
          for (const isPlayer of [true, false]) {
            const card = {id:'cast-fixture',name:'Cast Fixture',isPlayer,npcTemplateId:'cast',profile:{bio:'From the northern road'},aliases:[],images:[],statusOverrides:{Health:'20'}};
            const viewState = {charView:'profile'};
            renderCharacterEditor(card,host,{viewState});
            await new Promise(resolve=>setTimeout(resolve,30));
            const label = isPlayer ? 'player' : 'npc';
            result[label+'Profile'] = !!host.querySelector('.sillynpc-cv-body')
              && !!host.querySelector('.sillynpc-cv-portrait') && host.textContent.includes('From the northern road')
              && [...host.querySelectorAll('.sillynpc-charview-tab')].slice(0,2).map(el=>el.textContent).join(',')==='Profile,Edit';
            host.querySelector('[data-view="edit"]').click();
            result[label+'Edit'] = !!host.querySelector('.sillynpc-editor-main') && !!host.querySelector('.sillynpc-profile-input')
              && !!host.querySelector('.sillynpc-overrides-grid') && !!host.querySelector('.sillynpc-memory-section');
            result[label+'MultilineEditors'] = host.querySelectorAll('textarea.sillynpc-profile-input').length === 2
              && !host.querySelector('input.sillynpc-profile-input');
            result[label+'Ownership'] = isPlayer ? !host.querySelector('.name-input') && !host.querySelector('.sillynpc-delete-btn')
              && !host.querySelector('.sillynpc-trigger-level-up') && host.textContent.includes('selected SillyTavern persona')
              : !!host.querySelector('.name-input') && !!host.querySelector('.sillynpc-delete-btn') && !!host.querySelector('.sillynpc-trigger-level-up');
          }
          const strip = text => text.replace(/^import\\s+[\\s\\S]*?\\s+from\\s+['"][^'"]+['"];\\s*/gm, '').replaceAll('export function ', 'function ');
          const source = await (await fetch(root+'src/ui/manage/ui-manage-overrides.js')).text();
          let writes=[]; const state={player:{stats:{Health:'20'}}};
          const api = new Function('npcStatsFor','getSettings','saveSettings','triggerReprocess','escapeHtml',
            'syncOverrideToActiveState','loadStateFromMetadata','applyUpdate','getCurrentPersonaKey','getContext','constrainNumericStat','isPoolStat','buildChoiceSelect','isChoiceField',
            strip(source)+'; return {renderOverridesSection,commitStatEdits};')(
              ()=>[],()=>settings,()=>{},()=>{},value=>value,()=>{},()=>state,(change)=>{writes.push(change);Object.assign(state.player.stats,change.player.stats);},()=>fixturePersona,fixtureContext,
              (stat,value,existing)=>/^\\d+$/.test(value)?value:existing,()=>false,()=>{},()=>false);
          host.replaceChildren(); api.renderOverridesSection({isPlayer:true},host);
          const input=host.querySelector('.override-val-input'); input.value='30'; input.dispatchEvent(new Event('input'));
          result.noPartialReading=writes.length===0;
          api.commitStatEdits(host); api.commitStatEdits(host);
          result.focusedStatSavedOnce=writes.length===1 && writes[0].player.stats.Health==='30';
          input.value='invalid'; api.commitStatEdits(host);
          result.acceptedReadingShown=input.value==='30' && writes[1].player.stats.Health==='30';
          input.value='40'; fixturePersona='another-persona'; api.commitStatEdits(host);
          result.personaBoundary=writes.length===2;
          fixturePersona='cast-persona'; input.value='50'; fixtureChatId='another-chat'; api.commitStatEdits(host);
          result.chatBoundary=writes.length===2;
          const profile={old:'Known history'};
          result.legacyProfileValue=profileFieldValue(profile,{id:'new',legacyId:'old'})==='Known history';
        } catch(error) {result.error=error.stack;}
        finally {host.remove();}
        document.documentElement.setAttribute('data-cast-shared',JSON.stringify(result));
      `; document.body.append(script);
    """)
    result = None
    for _ in range(100):
        raw = browser.execute("return document.documentElement.getAttribute('data-cast-shared')")
        if raw:
            result = json.loads(raw)
            break
        time.sleep(0.1)
    browser.execute("document.querySelector('#sillynpc-cast-fixture')?.remove(); document.documentElement.removeAttribute('data-cast-shared')")
    assert result and 'error' not in result and all(result.values()), result
    print('Shared Cast UI passed:', json.dumps(result))
