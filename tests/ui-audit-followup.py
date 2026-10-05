"""Unsaved live checks for retired tracker features and scan overflow; no model requests."""
import json
import time
from ui_webdriver import browser_session
with browser_session() as browser:
    browser.execute("""const entry = [...document.scripts].find(s => s.src.includes('/SillyNPC-XP/index.js'));
const script = document.createElement('script'); script.type = 'module'; script.id = 'sillynpc-audit-check';
script.textContent = `
const root = ${JSON.stringify(new URL('.', entry.src).href)};
const { getSettings } = await import(root + 'src/core/settings.js');
const { estimateScan, scanHistoryForCollections, collectHistoryChunks } = await import(root + 'src/story/history-scan.js');
const { renderStatusView } = await import(root + 'src/ui/tracker/ui-tracker-settings.js');
const { buildExtractionSchema } = await import(root + 'src/tracker/extractor/status-extractor-schema.js');
const { replaceStatTag } = await import(root + 'src/tracker/ui/status-ui-template-core.js');
const settings = getSettings().statusTracker;
const chat = SillyTavern.getContext().chat;
const savedChat = chat.slice();
const keys = ['scanDepth', 'scanCharBudget', 'scanMaxChunks', 'collections'];
const saved = Object.fromEntries(keys.map(k => [k, settings[k]]));
const result = {};
try {
  const schema = buildExtractionSchema(settings);
  result.readerHasNoGoals = !JSON.stringify(schema).includes('\"goals\"');
  const container = document.createElement('div'); renderStatusView(container);
  result.noClockControls = !container.querySelector('[data-setting*="clock"], [data-setting*="timeRules"]') && !container.textContent.includes('Time Rules');
  const field = document.createElement('div');
  field.innerHTML = replaceStatTag('{{Time}}', { name: 'Time', type: 'text', format: '{{name}}: {{value}}' }, 'Day 3, 06:15', 'global');
  result.timeEditable = field.querySelector('[contenteditable=true][data-key=Time]')?.textContent === 'Day 3, 06:15';
  Object.assign(settings, { scanDepth: 0, scanCharBudget: 1000, scanMaxChunks: 0, collections: [{id: 'inventory', fields: [{name:'name',isPrimary:true}]}] });
  chat.splice(0, chat.length, {is_user:true,mes:'x'.repeat(2000)});
  result.estimateError = estimateScan().error;
  result.scan = await scanHistoryForCollections();
  chat.splice(0,chat.length,{is_user:true,mes:'x'.repeat(490)}, {is_user:true,mes:'y'.repeat(490)});
  const chunks = collectHistoryChunks(settings);
  result.exactBudget = chunks.length === 1 && chunks[0].chars === 1000 && chunks[0].text.length === 1000;
} catch(e) { result.error = String(e); }
finally {
 chat.splice(0,chat.length,...savedChat);
 for(const k of keys) { if(saved[k] === undefined) delete settings[k]; else settings[k]=saved[k]; }
}
document.documentElement.setAttribute('data-audit-check',JSON.stringify(result));`;
document.head.appendChild(script);""")
    result = None
    try:
        for _ in range(40):
            raw=browser.execute("return document.documentElement.getAttribute('data-audit-check')")
            if raw:
                result=json.loads(raw); break
            time.sleep(.25)
    finally:
        browser.execute("document.querySelector('#sillynpc-audit-check')?.remove(); document.documentElement.removeAttribute('data-audit-check');")
    assert result and not result.get('error'), result
    assert result['noClockControls'] and result['timeEditable'] and result['exactBudget'] and result['readerHasNoGoals'],result
    assert 'No requests were made' in result['estimateError'],result
    assert result['scan']['ok'] is False and 'No requests were made' in result['scan']['reason'],result
    print('Live audit follow-up checks passed:',json.dumps(result))
