import { promptText } from '../prompts/prompt-texts.js';
import { getSettings, saveSettings, defaultSettings, normaliseStatDefs } from '../core/settings.js';
import { extractJSON, safeJsonParse, splitValue, escapeRegExp, ceilingFromValue } from '../core/utils.js';
import { charactersFromActivatedLore } from '../lore/activated-lore.js';

export function bind(deps) {
function createInitialState() {
    const settings = getSettings().statusTracker;
    const state = {
        global: {},
        characters: [],
        player: {
            name: 'Player',
            stats: {},
            collections: {}
        },
        recently_deleted: {},
        timestamp: Date.now()
    };
    
    (settings.globalStats || []).forEach(stat => {
        if (stat && stat.name) {
            state.global[stat.name] = deps.getInitialStatValue(stat.defaultValue, stat.maxStatValue, stat);
        }
    });

    (settings.playerStats || []).forEach(stat => {
        if (stat && stat.name) {
            state.player.stats[stat.name] = deps.getInitialStatValue(stat.defaultValue, stat.maxStatValue, stat);
        }
    });
    
    return state;
}

/**
 * Summarizes a collection into a compact string for token efficiency.
 * If includeFull is true, it ignores the threshold and returns all items.
 */
function summarizeCollection(collectionId, items, includeFull = false) {
    const settings = getSettings().statusTracker;
    const colDef = settings.collections.find(c => c.id === collectionId);
    const colName = colDef ? colDef.name : collectionId;

    if (!items || items.length === 0) {
        if (includeFull) return `${colName}: (empty)`;
        return null;
    }
    
    // Everything, always. This function only ever builds a prompt - the tracker box has
    // its own summariser in status-ui.js - and it used to cut the list at
    // summaryThreshold, a setting labelled "Items Shown Per Collection" whose help says
    // "the AI always sees the full list either way". It did not: in extraction mode, which
    // is the default, a character with more spells than the threshold had the rest replaced
    // with "+N more...", so the model was told something existed but not what it was.
    const itemStrings = items.map(item => {
        const primaryField = colDef?.fields?.find(f => f.isPrimary) || { name: 'name' };
        const nameVal = item[primaryField.name] || item.name || 'Unknown Item';
        
        if (includeFull && colDef?.fields) {
            const fieldsStrList = [];
            colDef.fields.forEach(field => {
                if (field.isPrimary) return;
                const val = item[field.name];
                if (val !== undefined && val !== null && val !== '') {
                    fieldsStrList.push(`${field.name}: ${val}`);
                }
            });
            if (fieldsStrList.length > 0) {
                return `${nameVal} (${fieldsStrList.join(', ')})`;
            }
        }

        let str = nameVal;
        // Try to find a numeric quantity field to display
        const qtyField = colDef?.fields?.find(f => f.type === 'number' && (f.name === 'quantity' || f.name === 'qty' || f.name === 'count'));
        const qty = qtyField ? item[qtyField.name] : item.quantity;
        
        if (qty !== undefined && parseInt(qty) > 1) {
            str += ` (x${qty})`;
        }
        return str;
    });

    let output = `${colName}: ${itemStrings.join(', ')}`;
    return output;
}

/**
 * Formats the state into a compact text block for prompt injection.
 * For prompt injection, we now include the FULL collection list to support Full State Sync.
 */
function formatCompactStatus(state, fullDetail = false) {
    // The world, the player and each character, one line each. The heading and the sections
    // after these lines are the 'sceneBlock' text in prompt-texts.js.
    let output = '';
    
    /* Through the schema, not the stored object. A stat deleted in System Builder leaves its
       value behind in the chat, and this block used to send it to the story model on every
       single message - for a stat that could no longer change and was no longer configured
       to exist. See statsInSystem. */
    const globalParts = [];
    for (const [key, val] of Object.entries(deps.statsInSystem(state.global, 'globalStats'))) {
        if (val !== undefined && val !== null && val !== '') {
            globalParts.push(`${key}=${val}`);
        }
    }
    if (globalParts.length > 0) {
        output += `Global: ${globalParts.join(', ')}\n`;
    }

    const settings = getSettings().statusTracker;

    if (state.player) {
        const playerParts = [];
        for (const [key, val] of Object.entries(deps.statsInSystem(state.player.stats, 'playerStats'))) {
            if (val !== undefined && val !== null && val !== '') {
                playerParts.push(`${key}=${val}`);
            }
        }
        
        let playerLine = `Player (${state.player.name || 'You'}): ${playerParts.join(', ')}`;
        
        const colSummaries = [];
        // When fullDetail is true, we show all relevant collections even if empty
        if (fullDetail) {
            const relevantCollections = (settings.collections || []).filter(c => c.target === 'all' || c.target === 'player');
            relevantCollections.forEach(col => {
                const items = state.player.collections?.[col.id] || [];
                const summary = summarizeCollection(col.id, items, fullDetail);
                if (summary) colSummaries.push(summary);
            });
        } else if (state.player.collections) {
            for (const [colId, items] of Object.entries(state.player.collections)) {
                const summary = summarizeCollection(colId, items, fullDetail);
                if (summary) colSummaries.push(summary);
            }
        }
        
        if (colSummaries.length > 0) {
            playerLine += ` | ${colSummaries.join(' | ')}`;
        }
        output += playerLine + "\n";
    }
    
    if (state.characters && Array.isArray(state.characters)) {
        for (const char of state.characters) {
            const charParts = [];
            for (const [key, val] of Object.entries(deps.statsInSystem(char.stats, 'npcStats'))) {
                if (val !== undefined && val !== null && val !== '') {
                    charParts.push(`${key}=${val}`);
                }
            }
            
            let charLine = `${char.name}: ${charParts.join(', ')}`;
            if (charParts.length === 0) charLine = `${char.name}: Present`;

            const colSummaries = [];
            if (fullDetail) {
                const relevantCollections = (settings.collections || []).filter(c => c.target === 'all' || c.target === 'npc');
                relevantCollections.forEach(col => {
                    const items = char.collections?.[col.id] || [];
                    const summary = summarizeCollection(col.id, items, fullDetail);
                    if (summary) colSummaries.push(summary);
                });
            } else if (char.collections) {
                for (const [colId, items] of Object.entries(char.collections)) {
                    const summary = summarizeCollection(colId, items, fullDetail);
                    if (summary) colSummaries.push(summary);
                }
            }
            
            if (colSummaries.length > 0) {
                charLine += ` | ${colSummaries.join(' | ')}`;
            }
            output += charLine + "\n";
        }
    }
    

    return promptText('sceneBlock', {
        status: output.trim(),
        // Who these people actually are, for everyone the lines above just listed.
        profiles: deps.describeCastProfiles(state),
        // And who the story just named without putting on stage.
        offstage: describeNamedButUnlisted(state),
        // What the bracketed lines on the earlier messages are, when they are being sent.
        rule: settings.historyNotes ? promptText('historyNoteRule') : '',
    }).trim();
}

/**
 * Age, appearance, personality and speech, for the people in the scene.
 *
 * These four were collected, filled, displayed and exported, and never once shown to the
 * narrator. Worse than merely unused: the lore writer is told not to describe them because
 * "those are fields on the character", which assumed they arrived some other way - so
 * filling a profile in actually removed that material from the one thing the model does
 * read, and put it where nothing looked. A character with a filled profile gave the
 * narrator less to work with than one without.
 *
 * Here rather than on the lore entry because this is how somebody is played, and it has to
 * be in front of the model every time they speak. An entry only fires when its keyword
 * matches, which is not the same as being on stage.
 *
 * Only the cast the block already lists, so this costs nothing for characters who are not
 * in the scene, and only characters with something written.
 */
/**
 * Characters whose lorebook entry fired, who are not in the scene list.
 *
 * Their entry reaching the prompt without them means the narrator gets a page of background
 * about somebody and none of their numbers or their profile - so when the story gives one of
 * them a line, everything except the entry text is invented.
 *
 * The wording is the careful part. Their entry fired because a keyword matched, which says
 * they were *named* recently and says nothing about where they are. Claiming they are absent
 * invites the model to write them out of a room they may be standing in; claiming nothing at
 * all invites it to read a list of names as a cast to use. So this asserts neither, and says
 * outright that being listed is not a reason to bring anyone in.
 *
 * Deliberately unlike the extraction prompt's "KNOWN BUT NOT IN THE SCENE", which does state
 * absence - correctly, because there it exists to stop the reader re-adding their belongings.
 */
function describeNamedButUnlisted(state) {
    const listed = new Set((state.characters || [])
        .map(c => String(c?.name ?? '').trim().toLowerCase())
        .filter(Boolean));
    const player = String(state.player?.name ?? '').trim().toLowerCase();
    if (player) listed.add(player);

    const lines = [];
    const seen = new Set();

    for (const card of charactersFromActivatedLore()) {
        const key = String(card?.name ?? '').trim().toLowerCase();
        if (!key || listed.has(key) || seen.has(key)) continue;
        seen.add(key);

        // What they last walked in carrying, from the card - they are not in state, so
        // there are no live values to read.
        const stats = Object.entries(card.statusOverrides || {})
            .filter(([, value]) => String(value ?? '').trim() !== '')
            .map(([name, value]) => `${name}=${value}`)
            .join(', ');

        /* Their belongings, in full, as anybody in the room gets them. They had none at all
           once, which is the fault this block exists to prevent one step removed: the narrator
           knew Nikolett was somebody without knowing she carries anything, so the moment the
           story handed her something it was invented.

           Names alone were tried, to keep an absent character's skill descriptions from being
           pushed at the narrator every turn. That is the same fault one step further on: a
           name with no description is invented the moment the story uses it, and this block
           only ever holds people the story has just pulled in by their lore. Empty collections
           are skipped - "(empty)" is worth its space for the people in the room, not for six
           who are not. */
        const carried = Object.entries(card.statusCollections || {})
            .map(([colId, items]) => summarizeCollection(colId, items, true))
            .filter(Boolean);

        const profile = deps.describeProfileInline(card);

        const parts = [stats, ...carried, profile].filter(Boolean);
        if (parts.length) lines.push(`${card.name} - ${parts.join(' | ')}`);
    }

    if (!lines.length) return '';
    /* No mention of the scene list, deliberately. "Also on file, and not in the scene list
       above" was the first wording, and "not in the scene list" is one careless reading away
       from "not in the scene" - which is the exact claim this block must not make. What the
       block is for is enough; why these names are in a separate paragraph is our business. */
    return lines.join('\n');
}

/** The four profile fields on one line, or '' when none is written. */

Object.defineProperties(deps, {
    createInitialState: { enumerable: true, configurable: true, get: () => createInitialState },
    formatCompactStatus: { enumerable: true, configurable: true, get: () => formatCompactStatus },
});
}
