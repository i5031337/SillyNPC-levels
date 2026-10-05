"""Read-only live progression editor fixtures; no settings are saved."""
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
            {id:'rank',name:'Rank',type:'number',defaultValue:'1'},
            {id:'health',name:'Health',type:'number',defaultValue:'6/10'}];
          const template={id:'hero',statIds:['earned','rank','health'],progression:{enabled:true,xpFieldId:'earned',levelFieldId:'rank',statGrowth:'all',statIds:['health'],increments:{health:2}}};
          settings.statusTracker={playerStats:structuredClone(stats),npcStats:structuredClone(stats),npcTemplates:[template],progression:{player:structuredClone(template.progression)}};
          const render=(owner)=>{host.replaceChildren(buildProgressionEditor({template:owner,onSave:()=>{},onRefresh:()=>render(owner)}));};
          render();
          result.playerFields=[...host.querySelectorAll('select')].length===3;
          result.playerGrowth=!host.querySelector('input[type=number]') && host.textContent.includes('0–3');
          result.narrowLayout=host.scrollWidth<=host.clientWidth+2;
          render(template);
          const growth=host.querySelector('[aria-label="Stat growth"]'); growth.value='none'; growth.dispatchEvent(new Event('change'));
          result.npcPolicy=template.progression.statGrowth==='none' && !host.querySelector('input[type=number]');
          result.npcLevelPersists=settings.statusTracker.npcStats.find(s=>s.id==='rank').updatePolicy==='advancement';
          const enable=host.querySelector('[aria-label="Enable level progression"]'); enable.checked=false; enable.dispatchEvent(new Event('change'));
          result.disabledControls=!host.querySelector('[aria-label="Stat growth"]') && !!host.querySelector('[aria-label="XP field"]');
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
