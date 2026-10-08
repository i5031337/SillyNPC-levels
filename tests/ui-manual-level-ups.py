"""Unsaved card-editor and manual level-up fixture in the running host."""
import json
import time
from ui_webdriver import browser_session

with browser_session() as browser:
    browser.execute("""
      const entry = [...document.scripts].find(s => s.src.includes('/SillyNPC-XP/index.js'));
      const script = document.createElement('script'); script.type='module'; script.id='manual-level-fixture';
      script.textContent = `
        const result={}; let settings, savedSettings, live, savedLive, manageState, savedManage, host;
        try {
          const root=${JSON.stringify(new URL('.', entry.src).href)};
          const {getSettings}=await import(root+'src/core/settings.js');
          const {loadStateFromMetadata,applyUpdate}=await import(root+'src/tracker/status-logic.js');
          const {buildUpdateFromChanges}=await import(root+'src/tracker/status-diff.js');
          const {createManualLevelUpService}=await import(root+'src/tracker/manual-level-up-logic.js');
          const {buildManualLevelUpSection}=await import(root+'src/ui/characters/ui-manual-level-up.js');
          const {renderEditor}=await import(root+'src/ui/manage/ui-manage-editor.js');
          ({manageState}=await import(root+'src/ui/manage/ui-manage-state.js'));
          settings=getSettings(); savedSettings={statusTracker:settings.statusTracker, characters:settings.characters, enabled:settings.enabled};
          savedManage={...manageState}; live=loadStateFromMetadata(); savedLive=structuredClone(live);
          const stats=[{id:'xp',name:'Experience',type:'number',defaultValue:'0/20'},
            {id:'lv',name:'Rank',type:'number',locked:true,defaultValue:''},
            {id:'mana',name:'Mana',type:'number',defaultValue:'10/10'},
            {id:'power',name:'Power',type:'number',maxStatValue:'255',defaultValue:''}];
          const progression={enabled:true,xpFieldId:'xp',levelFieldId:'lv',pointsPerLevel:3,assignment:'random',statIds:['mana','power']};
          const tracker={...structuredClone(settings.statusTracker),globalStats:[],playerStats:[],npcStats:stats,
            npcTemplates:[{id:'mage',name:'Mage',statIds:stats.map(s=>s.id),progression}],collections:[]};
          const card={id:'manual-fixture',name:'Fixture Mira',npcTemplateId:'mage',aliases:[],images:[],imageUrl:'',profile:{},color:'#fff',
            statusOverrides:{Experience:'14/20',Rank:'1',Mana:'6/10',Power:'255/255'},statusCollections:{}};
          tracker.presets={[settings.activeSystem]:{definition:{npcTemplates:tracker.npcTemplates,stats:{npc:stats}}}};
          settings.statusTracker=tracker; settings.characters=[card]; settings.enabled=true;
          const actor={id:card.id,name:card.name,npcTemplateId:card.npcTemplateId,stats:{...card.statusOverrides},collections:{}};
          live.characters=[actor];
          host=document.createElement('div'); host.innerHTML='<div id="sillynpc-editor-view"></div>'; document.body.append(host);
          Object.assign(manageState,{manageRoot:host,editingCharId:card.id,charView:'edit'}); renderEditor(()=>{});
          result.editorButton=host.querySelector('.sillynpc-trigger-level-up')?.textContent==='Trigger Level-up';
          host.querySelector('[data-view="profile"]').click();
          result.editOnly=!host.querySelector('.sillynpc-trigger-level-up');
          const context={getCurrentChatId:()=> 'fixture-chat',chatMetadata:{},chat:[]};
          let writes=0, sequence=0;
          const service=createManualLevelUpService({getContext:()=>context,getSettings:()=>settings,getCards:()=>[card],
            getPersonaId:()=> 'fixture-persona',loadState:()=>live,save:()=>{},newId:()=>String(++sequence),random:()=>.99,
            requestExtraction:()=>{throw Error('Unexpected LLM request');},buildUpdate:buildUpdateFromChanges,
            applyUpdate:(update,options)=>{
              const preview=applyUpdate(update,{...options,dryRun:true}); if(!preview) return null;
              live.characters=preview.characters;
              card.statusOverrides={...live.characters[0].stats}; writes++; return live;
            }});
          const refresh=()=>host.replaceChildren(buildManualLevelUpSection(card,{service,onChange:refresh})); refresh();
          const originalTrigger=service.trigger; service.trigger=async id=>{try{return await originalTrigger(id);}catch(e){result.triggerError=String(e);throw e;}}; host.querySelector('.sillynpc-trigger-level-up').click();
          for(let i=0;i<100 && !host.querySelector('.sillynpc-point-allocation');i++) await new Promise(r=>setTimeout(r,20));
          result.advanced=card.statusOverrides.Rank==='2' && card.statusOverrides.Experience==='14/20';
          result.review=host.textContent.includes('Level 1 → 2') && host.textContent.includes('Mana') && host.textContent.includes('+3');
          result.waitsForReview=card.statusOverrides.Mana==='6/10';
          [...host.querySelectorAll('button')].find(b=>b.textContent.includes('Apply selected')).click();
          result.pool=card.statusOverrides.Mana==='9/13' && card.statusOverrides.Power==='255/255';
          result.completed=service.records(card.id).length===0 && !host.querySelector('.sillynpc-review-panel') && writes===2;
          tracker.npcTemplates[0].progression.enabled=false; refresh();
          result.disabled=host.querySelector('.sillynpc-trigger-level-up').disabled && host.textContent.includes('Enable progression');
        } catch(error) {result.error=String(error);result.stack=error.stack;}
        finally {
          host?.remove(); if(manageState&&savedManage) Object.assign(manageState,savedManage);
          if(settings&&savedSettings) Object.assign(settings,savedSettings);
          if(live&&savedLive){for(const key of Object.keys(live)) delete live[key];Object.assign(live,savedLive);}
        }
        document.documentElement.setAttribute('data-manual-level-fixture',JSON.stringify(result));
      `; document.head.append(script);
    """)
    result = None
    for _ in range(100):
        raw = browser.execute("return document.documentElement.getAttribute('data-manual-level-fixture')")
        if raw:
            result = json.loads(raw)
            break
        time.sleep(.25)
    browser.execute("document.querySelector('#manual-level-fixture')?.remove();document.documentElement.removeAttribute('data-manual-level-fixture');")
    expected = ['editorButton', 'editOnly', 'advanced', 'review', 'waitsForReview', 'pool', 'completed', 'disabled']
    assert result and all(result.get(key) for key in expected), result
    print('SillyNPC manual level-up UI passed:', json.dumps(result))
