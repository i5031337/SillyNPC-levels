"""Read-only memory review fixture; no saves or model requests."""
import json
import time
from ui_webdriver import browser_session

with browser_session() as browser:
    execute = browser.execute
    execute("""const entry = [...document.scripts].find(s => s.src.includes('/SillyNPC-XP/index.js'));
      if (!entry) throw new Error('Extension entry missing');
      const script = document.createElement('script'); script.type = 'module'; script.id = 'sillynpc-memory-fixture';
      script.textContent = `
        const result = {}; let settings, savedEnabled, savedTrackerEnabled, chat, savedChat, host, refreshMemoryButton;
        try {
          const root = ${JSON.stringify(new URL('.', entry.src).href)};
          const { getSettings } = await import(root + 'src/core/settings.js');
          const { renderReviewPanel } = await import(root + 'src/ui/tracker/ui-change-review.js');
          const { renderStatusTrackerBox } = await import(root + 'src/tracker/ui/status-ui-box.js');
          const { isEditingInside, insideTracker } = await import(root + 'src/tracker/ui/status-ui-guards.js');
          const { buildProfilesEditor } = await import(root + 'src/ui/system/ui-system-profiles.js');
          const { createMemoryService } = await import(root + 'src/memory/memory-service.js');
          const { applyReviewedMemories } = await import(root + 'src/memory/memory-review.js');
          ({ refreshMemoryButton } = await import(root + 'src/ui/tracker/ui-memory-button.js'));
          const { normalizeSystemDefinition } = await import(root + 'src/core/system-schema.js');
          const definition = normalizeSystemDefinition({schemaVersion:2, profiles: [], memories: {enabled:false,guidance:'',interval:8,maxEntriesPerCharacter:50} });
          let saves = 0, refreshes = 0;
          const controls = buildProfilesEditor(() => {}, {
            definition: () => definition, getSettings: () => ({statusTracker: {}}), saveSettings: () => saves++, refreshMemoryButton: () => refreshes++ });
          result.systemControls = !!controls.querySelector('.profile-memory-guidance')
            && controls.querySelector('.profile-memory-interval').value === '8'
            && controls.querySelector('.profile-memory-limit').value === '50';
          const captureToggle = controls.querySelector('.profile-memory-enabled'); captureToggle.checked = true;
          captureToggle.dispatchEvent(new Event('change'));
          const guidance = controls.querySelector('.profile-memory-guidance'); guidance.value = 'Remember promises';
          guidance.dispatchEvent(new Event('input'));
          result.systemControlsSave = definition.memories.enabled && definition.memories.guidance === 'Remember promises'
            && saves === 2 && refreshes === 1;
          const fixtureSettings = { enabled:true, activeSystem:'fixture', statusTracker:{presets:{fixture:{definition}}} };
          const fixtureContext = { chatMetadata:{}, getCurrentChatId: () => 'fixture-chat',
            chat:[{is_user:true,mes:'Ada, please guard the bridge.'},{mes:'Ada promises to guard the bridge.'}] };
          let fixtureState = {characters:[]}, proposals = [], requests = 0;
          const card = {id:'ada',name:'Ada',profile:{}};
          const service = createMemoryService({getSettings:()=>fixtureSettings,getContext:()=>fixtureContext,
            getCards:()=>[card],loadState:()=>fixtureState,saveState:()=>{},saveChat:()=>{},syncLore:()=>{},
            getPending:()=>proposals,replacePending:(_,rows)=>proposals=rows,enqueue:(_,rows)=>proposals.push(...rows),
            parse:value=>value,request:async()=>{requests++;return {memories:[{npcId:'ada',text:'Ada promised to guard the bridge.',sourceMessageIds:[1]}]};}});
          const reading = await service.read({manual:true});
          const acceptance = applyReviewedMemories(fixtureState, proposals, [card], {
            messages:fixtureContext.chat,systemId:'fixture',chatId:'fixture-chat',limit:50});
          result.readerAcceptance = reading.ok && reading.pending === 1 && requests === 1
            && acceptance.applied === 1 && acceptance.changed[0].store.entries[0].text.includes('bridge');
          fixtureContext.chat[1].mes = 'Ada refuses to guard the bridge.';
          service.reconcile();
          result.readerInvalidation = proposals.length === 0 && fixtureState.npcMemories?.['id:ada']?.entries.length === 0;
          settings = getSettings(); savedEnabled = settings.enabled; savedTrackerEnabled = settings.statusTracker.enabled;
          settings.enabled = true; settings.statusTracker.enabled = false;
          const actualMemoryConfig = settings.statusTracker.presets[settings.activeSystem].definition.memories;
          const savedCapture = actualMemoryConfig.enabled;
          try {
            actualMemoryConfig.enabled = true; refreshMemoryButton();
            result.manualButton = document.getElementById('sillynpc-memory-button')?.getAttribute('aria-label') === 'Read memories now';
          } finally { actualMemoryConfig.enabled = savedCapture; refreshMemoryButton(); }
          chat = SillyTavern.getContext().chat; savedChat = chat.slice();
          chat.splice(0, chat.length, { mes: 'A promise at the bridge', extra: { sillynpc_pending: [
            { id: 'memory-one', kind: 'memory-add', scope: 'character', actor: 'Fixture Ada', cardId: 'ada',
              label: 'Memory', after: 'Promised to guard the bridge', note: 'Reply 1' },
            { kind: 'item-add', scope: 'character', actor: 'Fixture Ada', collectionId: 'items',
              label: 'Map', item: {name:'Map'}, after: 'Map' }
          ] }});
          host = document.createElement('div'); host.setAttribute('mesid', '0');
          host.style.width = '280px'; host.style.position = 'fixed'; host.style.left = '0'; host.style.top = '0';
          const text = document.createElement('div'); text.className = 'mes_text'; host.append(text); document.body.append(host);
          renderReviewPanel(host, 0);
          result.sharedPanel = host.querySelectorAll('.sillynpc-review-panel').length === 1
            && host.querySelectorAll('.sillynpc-review-row').length === 2;
          const memory = host.querySelector('.kind-memory-add'); const editor = memory.querySelector('textarea');
          result.editable = editor?.value === 'Promised to guard the bridge';
          editor.value = 'Corrected promise'; editor.dispatchEvent(new Event('input')); editor.focus();
          result.editProtected = isEditingInside(host) && insideTracker(editor);
          editor.blur();
          const toggle = memory.querySelector('.sillynpc-review-toggle'); toggle.click();
          result.rejectable = !toggle.checked; toggle.click(); result.acceptable = toggle.checked;
          result.sharedActions = [...host.querySelectorAll('button')].some(b => b.textContent.includes('Apply selected'))
            && [...host.querySelectorAll('button')].some(b => b.textContent.includes('Discard all'));
          result.noStandingRule = !memory.querySelector('.sillynpc-review-never');
          result.narrowLayout = host.scrollWidth <= host.clientWidth + 2;
          renderStatusTrackerBox(host);
          result.trackerDisabled = !!host.querySelector('.sillynpc-review-panel')
            && !host.querySelector('.sillynpc-status-tracker-container');
        } catch (error) { result.error = String(error); result.stack = error.stack; }
        finally {
          host?.remove(); if (chat && savedChat) chat.splice(0, chat.length, ...savedChat);
          if (settings) { settings.enabled = savedEnabled; settings.statusTracker.enabled = savedTrackerEnabled; }
          refreshMemoryButton?.();
        }
        document.documentElement.setAttribute('data-memory-fixture', JSON.stringify(result));
      `; document.head.append(script);""")
    result = None
    for _ in range(100):
        raw = execute("return document.documentElement.getAttribute('data-memory-fixture')")
        if raw:
            result = json.loads(raw)
            break
        time.sleep(0.25)
    execute("document.querySelector('#sillynpc-memory-fixture')?.remove(); document.documentElement.removeAttribute('data-memory-fixture');")
    print(json.dumps(result, indent=2))
    checks = ['sharedPanel', 'editable', 'editProtected', 'rejectable', 'acceptable', 'sharedActions',
              'noStandingRule', 'narrowLayout', 'trackerDisabled', 'systemControls', 'systemControlsSave',
              'readerAcceptance', 'readerInvalidation', 'manualButton']
    if not result or result.get('error') or any(result.get(key) is not True for key in checks):
        raise SystemExit('Memory review fixture failed')
