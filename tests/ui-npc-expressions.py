"""Unsaved stage 2 host fixtures with mocked sprites and classification."""
import json
import time
from ui_webdriver import browser_session

with browser_session() as browser:
    browser.execute("""
      const entry = [...document.scripts].find(s => s.src.includes('/SillyNPC-XP/index.js'));
      const script = document.createElement('script'); script.type='module'; script.id='npc-expressions-fixture';
      script.textContent = `
        const result={}; let settings, savedSettings, context, metadata, chatLength, fixture, editor, originalFetch, expressionsSettings;
        let runtime;
        try {
          const root=${JSON.stringify(new URL('.', entry.src).href)};
          const {getSettings}=await import(root+'src/core/settings.js');
          const {buildExpressionsSection}=await import(root+'src/ui/characters/ui-expressions.js');
          const {classifierHint}=await import(root+'src/expressions/host-expressions.js');
          const {injectAtDialogueLines}=await import(root+'src/chat/chat-speech.js');
          runtime=await import(root+'src/expressions/npc-expressions.js');
          settings=getSettings(); context=SillyTavern.getContext();
          savedSettings={characters:settings.characters,enabled:settings.enabled};
          metadata={...context.chatMetadata}; chatLength=context.chat.length;
          expressionsSettings=context.extensionSettings.expressions;
          context.extensionSettings.expressions={...expressionsSettings,api:0};
          const cards=['A','B'].map(name=>({id:'expression-fixture-'+name,name:'Expression '+name,aliases:[],imageUrl:'/img/ai4.png',
            presentation:{expressions:{enabled:true,spriteFolder:'ExpressionPack/'+name,fallback:'neutral'}}}));
          settings.characters=cards; settings.enabled=true;
          context.chatMetadata.sillynpc_npcs=[];
          context.chatMetadata.sillynpc_cast={categories:null,include:[],exclude:[]};
          context.chat.push({mes:['Expression A: "First."','Expression B: "Second."','Expression A: "Last."'].join(String.fromCharCode(10)),swipe_id:0});
          fixture=document.createElement('div'); fixture.className='mes'; fixture.setAttribute('mesid',chatLength);
          fixture.innerHTML='<div class="mes_text"><p>Expression A: "First."</p><p>Expression B: "Second."</p><p>Expression A: "Last."</p></div>';
          document.querySelector('#chat').append(fixture);
          injectAtDialogueLines(fixture.querySelector('.mes_text'),cards,()=>'/img/ai4.png',false);
          const sprites=[{label:'joy',path:'/characters/../img/ai4.png?expression=joy'},
            {label:'neutral',path:'/characters/../img/ai4.png?expression=neutral'}];
          originalFetch=window.fetch;
          let packRequests=0;
          window.fetch=(url,...args)=>String(url).startsWith('/api/sprites/get?')
            ? (packRequests++,Promise.resolve(new Response(JSON.stringify(sprites),{headers:{'Content-Type':'application/json'}})))
            : originalFetch(url,...args);
          let calls=[];
          const adapters={loadPack:async()=>sprites,classify:async job=>{calls.push([job.line.npcId,job.line.text]);return 'joy';}};
          await runtime.completeNpcExpressions(chatLength,adapters);
          result.lastLines=JSON.stringify(calls)===JSON.stringify([[cards[1].id,'Second.'],[cards[0].id,'Last.']]);
          result.portraits=[...fixture.querySelectorAll('.sillynpc-chat-avatar')].every(a=>a.dataset.sillynpcExpression==='joy');
          runtime.renderNpcExpressions(fixture); await runtime.completeNpcExpressions(chatLength,adapters);
          result.cached=calls.length===2;
          result.baseUnchanged=cards.every(c=>c.imageUrl==='/img/ai4.png');
          const avatar=fixture.querySelector('.sillynpc-chat-avatar');
          avatar.dispatchEvent(new Event('error'));
          result.missingImageFallback=avatar.dataset.sillynpcExpression==='neutral';
          avatar.dispatchEvent(new Event('error'));
          result.missingFallbackPortrait=!avatar.dataset.sillynpcExpression&&avatar.src.endsWith('/img/ai4.png');
          runtime.renderNpcExpressions(fixture);
          context.chat[chatLength].swipe_id=1;
          runtime.renderNpcExpressions(fixture);
          result.swipeIsolation=[...fixture.querySelectorAll('.sillynpc-chat-avatar')].every(a=>!a.dataset.sillynpcExpression);
          runtime.resetNpcExpressions();
          let release;
          const pending=runtime.completeNpcExpressions(chatLength,{loadPack:async()=>sprites,
            classify:()=>new Promise(resolve=>{release=resolve;})});
          for(let i=0;i<50&&!release;i++) await new Promise(r=>setTimeout(r,10));
          context.chat[chatLength].mes='Edited fixture';
          release('joy'); await pending;
          runtime.renderNpcExpressions(fixture);
          result.staleRejected=[...fixture.querySelectorAll('.sillynpc-chat-avatar')].every(a=>!a.dataset.sillynpcExpression);
          result.unsupportedHint=classifierHint({api:2,promptType:'full'}).includes('conversation context')
            && classifierHint({api:2,promptType:'raw'}).includes('lock');
          let writes=0;
          editor=buildExpressionsSection(cards[0],{save:()=>writes++}); document.body.append(editor);
          editor.querySelector('button').click();
          for(let i=0;i<50&&!editor.textContent.includes('sprites available');i++) await new Promise(r=>setTimeout(r,10));
          result.preview=editor.textContent.includes('2 sprites available')&&!editor.querySelector('img').hidden&&packRequests===1;
          const fields=editor.querySelectorAll('input'); fields[1].value='Pack/too/deep'; fields[1].dispatchEvent(new Event('change'));
          result.invalidFolder=cards[0].presentation.expressions.spriteFolder==='ExpressionPack/A'&&writes===0;
          fields[0].checked=false; fields[0].dispatchEvent(new Event('change'));
          result.controls=cards[0].presentation.expressions.enabled===false&&writes===1;
          result.nativeHolderUntouched=!document.querySelector('#expression-holder [data-sillynpc-expression]');
        } catch(error) {result.error=String(error.stack||error);}
        finally {
          runtime?.resetNpcExpressions(); fixture?.remove(); editor?.remove();
          if(originalFetch) window.fetch=originalFetch;
          if(settings&&savedSettings) Object.assign(settings,savedSettings);
          if(context&&metadata){for(const key of Object.keys(context.chatMetadata)) delete context.chatMetadata[key];Object.assign(context.chatMetadata,metadata);}
          if(context&&chatLength!==undefined) context.chat.splice(chatLength);
          if(context) context.extensionSettings.expressions=expressionsSettings;
        }
        document.documentElement.setAttribute('data-npc-expressions-fixture',JSON.stringify(result));
      `; document.head.append(script);
    """)
    result = None
    try:
        for _ in range(100):
            raw = browser.execute("return document.documentElement.getAttribute('data-npc-expressions-fixture')")
            if raw:
                result = json.loads(raw)
                break
            time.sleep(.25)
        assert result and not result.get('error') and all(value is True for value in result.values()), result
        print('NPC expressions UI passed:', json.dumps(result))
    finally:
        browser.execute("document.querySelector('#npc-expressions-fixture')?.remove();document.documentElement.removeAttribute('data-npc-expressions-fixture');")
