/** Unsaved Stage 4 speech checks in headless Edge; --real-playback inspects generated audio. */
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = () => new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); });
});

async function main() {
    const profile = mkdtempSync(path.join(tmpdir(), 'sillynpc-tts-ui-'));
    const browserPort = await port();
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required',
        '--remote-allow-origins=*', `--remote-debugging-port=${browserPort}`,
        `--user-data-dir=${profile}`, 'http://127.0.0.1:8000/'], { stdio: 'ignore', windowsHide: true });
    let socket;
    let closeBrowser;
    try {
        let page;
        for (let i = 0; i < 100; i++) {
            try {
                const tabs = await (await fetch(`http://127.0.0.1:${browserPort}/json`)).json();
                page = tabs.find(tab => tab.type === 'page' && tab.url.includes('127.0.0.1:8000'));
                if (page) break;
            } catch { /* browser still starting */ }
            await sleep(100);
        }
        if (!page) throw new Error('Headless Edge did not open SillyTavern.');
        socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        const pending = new Map(); let serial = 0;
        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (!message.id) return;
            const waiter = pending.get(message.id); pending.delete(message.id);
            if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
        };
        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++serial; pending.set(id, { resolve, reject });
            socket.send(JSON.stringify({ id, method, params }));
        });
        closeBrowser = () => send('Browser.close');
        const evaluate = async expression => {
            for (let attempt = 0; attempt < 50; attempt++) {
                try {
                    const answer = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
                    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.text);
                    return answer.result.value;
                } catch (error) {
                    if (!String(error.message).includes('default execution context') || attempt === 49) throw error;
                    await sleep(100);
                }
            }
        };
        for (let i = 0; i < 100; i++) {
            if (await evaluate(`Boolean([...document.scripts].find(s => s.src.includes('SillyNPC-levels/index.js') || s.src.includes('SillyNPC-XP/index.js')))`)) break;
            await sleep(100);
        }
        const root = await evaluate(`new URL('.', [...document.scripts].find(s => s.src.includes('SillyNPC-levels/index.js') || s.src.includes('SillyNPC-XP/index.js')).src).href`);
        const fixture = `const out={root:${JSON.stringify(root)}};let section,settings,savedTts,savedCharacters,hostContext,chatLength,fixtureMes,originalFetch,originalPlay,nativeTts,savedNative;try {
            try{await import(${JSON.stringify(root + 'index.js')});out.entryOk=true}catch(error){out.entryError=String(error.stack||error)}
            for(let i=0;i<200&&!document.getElementById('sillynpc-tts-settings');i++)
                await new Promise(r=>setTimeout(r,100));
            const {getSettings}=await import(${JSON.stringify(root + 'src/core/settings.js')});
            const {buildVoicesSection}=await import(${JSON.stringify(root + 'src/ui/characters/ui-voices.js')});
            const {readSpeechUnits}=await import(${JSON.stringify(root + 'src/tts/speech-units.js')});
            const {previewNpcVoice}=await import(${JSON.stringify(root + 'src/tts/npc-tts.js')});
            const {playNpcMessage,renderNpcTtsControl,stopNpcTts}=await import(${JSON.stringify(root + 'src/tts/npc-tts.js')});
            settings=getSettings();savedTts=structuredClone(settings.tts);
            const host=SillyTavern.getContext().extensionSettings.tts?.['OpenAI Compatible'];
            out.panel=Boolean(document.getElementById('sillynpc-tts-settings'));
            out.mainPanel=Boolean(document.getElementById('sillynpc-settings'));
            out.extensionArea=Boolean(document.getElementById('extensions_settings2'));
            settings.tts={enabled:true,autoPlay:false,endpoint:host?.provider_endpoint||'',model:host?.model||'',
                voices:host?.available_voices||['alloy'],narratorVoice:(host?.available_voices||['alloy'])[0],speed:1};
            const card={id:'voice-fixture',name:'Voice Fixture',presentation:{voices:{}}};
            section=buildVoicesSection(card,{save:()=>out.saved=(out.saved||0)+1,
                previewVoice:${process.argv.includes('--preview') ? 'previewNpcVoice' : 'async()=>{out.mockPreview=true}'}});
            document.body.append(section);
            out.options=[...section.querySelectorAll('select option')].map(o=>o.value);
            const select=section.querySelector('select');select.value=out.options.find(v=>v.startsWith('voice:'));
            select.dispatchEvent(new Event('change'));
            out.selected=card.presentation.voices['SillyNPC OpenAI Compatible'];
            out.previewEnabled=!section.querySelector('button').disabled;
            section.querySelector('button').click();
            for(let i=0;i<300&&section.textContent.includes('Starting voice preview');i++)
                await new Promise(r=>setTimeout(r,100));
            out.previewStatus=section.querySelector('[role=status]').textContent;
            const mes=document.createElement('div');mes.className='mes';mes.setAttribute('mesid','0');
            mes.innerHTML='<div class="mes_text"><p>The hall went quiet.</p><p>Mira: “Wait.” <em>She lowers her sword.</em> “Stay.”</p><p>The door opened.</p><pre>secret code</pre></div>';
            const context={chat:[{mes:'fixture',swipe_id:0}],getCurrentChatId:()=> 'fixture'};
            out.units=readSpeechUnits(mes,{context,characters:[{id:'mira',name:'Mira',aliases:[]}],
                settings:{caseInsensitive:false},ignoredLabels:new Set(),personaFor:()=>null})
                .map(unit=>[unit.kind,unit.npcId,unit.text]);
            savedCharacters=settings.characters;
            settings.characters=[...savedCharacters,{id:'mira-tts-fixture',name:'Mira',aliases:[],
                presentation:{voices:{'SillyNPC OpenAI Compatible':{mode:'voice',voiceId:'nova',voiceName:'nova'}}}}];
            hostContext=SillyTavern.getContext();chatLength=hostContext.chat.length;
            hostContext.chat.push({mes:'The hall went quiet.\\nMira: "Wait." She lowers her sword.',swipe_id:0,is_user:false});
            fixtureMes=document.createElement('div');fixtureMes.className='mes';fixtureMes.setAttribute('mesid',String(chatLength));
            fixtureMes.innerHTML='<div class="mes_text"><p>The hall went quiet.</p><p>Mira: "Wait." She lowers her sword.</p></div>';
            document.querySelector('#chat').append(fixtureMes);
            renderNpcTtsControl(fixtureMes);out.manualButton=Boolean(fixtureMes.querySelector('.sillynpc-tts-play'));
            const realPlayback=${process.argv.includes('--real-playback')};
            const silence=realPlayback?null:await (await fetch('/sounds/silence.mp3')).blob();out.calls=[];out.audio=[];
            out.requestTimes=[];out.playStart=[];out.playEnd=[];
            originalPlay=HTMLMediaElement.prototype.play;
            HTMLMediaElement.prototype.play=function(...args){
                if(this.src.startsWith('blob:')){
                    out.playStart.push(performance.now());
                    this.addEventListener('ended',()=>out.playEnd.push(performance.now()),{once:true});
                }
                return originalPlay.apply(this,args);
            };
            originalFetch=window.fetch;
            window.fetch=async(url,options)=>{
                if(!String(url).includes('/api/openai/custom/generate-voice'))return originalFetch(url,options);
                out.requestTimes.push(performance.now());out.calls.push(JSON.parse(options.body));
                if(!realPlayback)return new Response(silence,{status:200,headers:{'Content-Type':'audio/mpeg'}});
                const response=await originalFetch(url,options);
                const bytes=await response.clone().arrayBuffer();
                const audioContext=new AudioContext();
                const decoded=await audioContext.decodeAudioData(bytes.slice(0));
                const samples=decoded.getChannelData(0);let energy=0,count=0;
                for(let i=0;i<samples.length;i+=64){energy+=samples[i]*samples[i];count++}
                out.audio.push({status:response.status,bytes:bytes.byteLength,
                    type:response.headers.get('Content-Type'),seconds:Number(decoded.duration.toFixed(2)),
                    rms:Number(Math.sqrt(energy/count).toFixed(5))});
                await audioContext.close();
                return response;
            };
            await playNpcMessage(chatLength);
            if(!realPlayback){
                nativeTts=hostContext.extensionSettings.tts;
                savedNative={enabled:nativeTts.enabled,auto_generation:nativeTts.auto_generation,
                    periodic_auto_generation:nativeTts.periodic_auto_generation};
                settings.tts.autoPlay=true;
                Object.assign(nativeTts,{enabled:false,auto_generation:false,periodic_auto_generation:false});
                await playNpcMessage(chatLength,{automatic:true});
                out.autoPlayed=out.calls.length===6;
                Object.assign(nativeTts,{enabled:true,auto_generation:true});
                await playNpcMessage(chatLength,{automatic:true});
                out.duplicateBlocked=out.calls.length===6;
            }
            stopNpcTts();
        }catch(error){out.error=String(error.stack||error)}finally{
            if(originalFetch)window.fetch=originalFetch;
            if(originalPlay)HTMLMediaElement.prototype.play=originalPlay;
            if(nativeTts&&savedNative)Object.assign(nativeTts,savedNative);
            fixtureMes?.remove();if(hostContext&&chatLength!==undefined)hostContext.chat.splice(chatLength);
            section?.remove();if(settings&&savedTts)settings.tts=savedTts;
            if(settings&&savedCharacters)settings.characters=savedCharacters}
        document.documentElement.setAttribute('data-npc-voices-fixture',JSON.stringify(out));`;
        await evaluate(`(() => { const s=document.createElement('script');s.type='module';s.id='npc-voices-fixture';s.textContent=${JSON.stringify(fixture)};document.head.append(s);return true })()`);
        let result;
        for (let i = 0; i < 400; i++) {
            result = await evaluate(`document.documentElement.getAttribute('data-npc-voices-fixture')`);
            if (result) break;
            await sleep(100);
        }
        if (!result) throw new Error('Voice fixture did not finish.');
        await evaluate(`(() => { document.getElementById('npc-voices-fixture')?.remove(); document.documentElement.removeAttribute('data-npc-voices-fixture'); return true })()`);
        console.log(result);
        const parsed = JSON.parse(result);
        if (parsed.error || !parsed.panel || !parsed.options.some(value => value.startsWith('voice:'))
            || parsed.saved !== 1 || !parsed.previewEnabled || parsed.previewStatus !== 'Voice preview finished.'
            || parsed.units?.map(unit => unit[0]).join(',') !== 'narration,dialogue,narration,dialogue,narration'
            || parsed.units?.some(unit => unit[2].includes('secret code'))
            || !parsed.manualButton || parsed.calls?.slice(0,3).map(call => call.input).join('|')
                !== 'The hall went quiet.|Wait.|She lowers her sword.'
            || parsed.playStart?.length < 3 || !parsed.playEnd?.length
            || parsed.requestTimes?.[1] >= parsed.playEnd[0]
            || parsed.requestTimes?.[2] >= parsed.playEnd[0]
            || (process.argv.includes('--real-playback')
                ? parsed.audio?.length !== 3 || parsed.audio.some(item => item.status !== 200
                    || item.bytes < 1000 || item.seconds <= 0 || item.rms <= 0.001)
                : !parsed.autoPlayed || !parsed.duplicateBlocked)
            || parsed.calls?.[1]?.voice !== 'nova' || parsed.calls?.[0]?.voice !== 'alloy')
            process.exitCode = 1;
    } finally {
        try { await Promise.race([closeBrowser?.(), sleep(1000)]); } catch { /* browser already closed */ }
        socket?.close();
        if (child.exitCode === null) child.kill();
        await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(3000)]);
        for (let i = 0; i < 20; i++) {
            try { rmSync(profile, { recursive: true, force: true }); break; }
            catch { if (i === 19) console.warn(`Temporary Edge profile remains: ${profile}`); await sleep(100); }
        }
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
