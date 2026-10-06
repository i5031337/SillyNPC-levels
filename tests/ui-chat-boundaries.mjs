import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

class Element {
    constructor(tag) {
        this.tag = tag;
        this.style = {};
        this.dataset = {};
        this.children = [];
        this.listeners = {};
        this.value = '';
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(event, callback) { this.listeners[event] = callback; }
}
const document = {
    createElement: tag => new Element(tag),
    createTextNode: text => text,
};
function load(file, bindings, result) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
        .replace(/^import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/gm, '')
        .replaceAll('export async function ', 'async function ')
        .replaceAll('export function ', 'function ');
    return new Function(...Object.keys(bindings), `${source}\nreturn ${result};`)(...Object.values(bindings));
}

for (const switchChat of [false, true]) {
    test(`new chat scope ${switchChat ? 'ignores confirmation after chat switch' : 'applies in the original chat'}`, async () => {
        let metadata = {};
        const saved = [];
        class Popup {
            constructor(wrap) { this.wrap = wrap; }
            async show() {
                this.wrap.children.find(child => child.tag === 'label').children[0].checked = true;
                if (switchChat) metadata = {};
                return 1;
            }
        }
        const offer = load('entry/entry-chat-scope.js', {
            document, Popup, POPUP_TYPE: { CONFIRM: 1 }, POPUP_RESULT: { AFFIRMATIVE: 1 },
            getContext: () => ({ chat: [], chatMetadata: metadata }), hasOpenChat: () => true,
            CAST_KEY: 'cast', UNCATEGORISED: '', getAllCategories: () => ['A', 'B'],
            setChatCast: cast => saved.push(cast), triggerReprocess: () => {},
            getSettings: () => ({ enabled: true }),
        }, 'offerChatScope');
        await offer();
        assert.equal(saved.length, switchChat ? 0 : 1);
    });

    test(`avatar alias picker ${switchChat ? 'ignores confirmation after chat switch' : 'returns the selected character'}`, async () => {
        let metadata = {};
        class Popup {
            constructor(wrap) { this.wrap = wrap; }
            async show() {
                this.wrap.children.find(child => child.tag === 'select').value = 'npc';
                if (switchChat) metadata = {};
                return 1;
            }
        }
        const ask = load('entry/entry-avatar-actions.js', {
            document, Popup, POPUP_TYPE: { CONFIRM: 1 }, POPUP_RESULT: { AFFIRMATIVE: 1 },
            getContext: () => ({ chatMetadata: metadata }),
            getAllCharacters: () => [{ id: 'npc', name: 'Alice' }],
        }, 'askAboutUnknownSpeaker');
        assert.deepEqual(await ask('Al'), switchChat ? null : { aliasOf: 'npc' });
    });

    test(`history cleanup ${switchChat ? 'ignores confirmation after chat switch' : 'cleans the original chat'}`, async () => {
        let metadata = {};
        let cleaned = 0;
        const build = load('ui/tracker/ui-tracker-context.js', {
            document, getContext: () => ({ chatMetadata: metadata }),
            Popup: { show: { confirm: async () => {
                if (switchChat) metadata = {};
                return true;
            } } },
            measureChatOverhead: () => ({ totalChars: 100, blockChars: 50, messages: 1, blockMessages: 1 }),
            estimateTokens: chars => chars / 4,
            cleanChatHistory: () => { cleaned++; return { cleaned: 1, removedChars: 50 }; },
            toastr: { success() {} },
        }, 'buildContextReport');
        const wrap = build();
        const button = wrap.children[1].children.find(child => child.tag === 'button');
        await button.listeners.click();
        assert.equal(cleaned, switchChat ? 0 : 1);
    });
}

test('bulk deletion keeps the selection named in its confirmation', async () => {
    let bulk;
    const deleted = [];
    const build = load('ui/shared/ui-bulk-select.js', {
        document,
        Popup: { show: { confirm: async () => {
            bulk.toggle('first', false);
            bulk.toggle('second', true);
            return true;
        } } },
    }, 'buildBulkBar');
    bulk = build({ noun: 'item', onRefresh() {}, onDelete: ids => deleted.push(...ids) });
    bulk.toggle('first', true);
    const button = bulk.bar.children.find(child => child.className.includes('sillynpc-bulk-delete'));
    await button.listeners.click();
    assert.deepEqual(deleted, ['first']);
});
