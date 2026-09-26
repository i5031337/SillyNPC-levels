import { escapeRegExp } from './utils.js';
import { LOG_PREFIX } from './constants.js';
import { summarizeCollectionUI, stripFieldReference, tidyLeftovers, renderFieldSet } from './status-ui-template-core.js';
import { renderCharacters } from './status-ui-template-characters.js';

export function buildStatusHtml(state, settings) {
    try {
        let html = settings.template;

        // Handle Global Stats Toggling
        if (!settings.showGlobalStats) {
            // Remove the entire header if it exists
            html = html.replace(/<div[^>]*class="[^"]*sillynpc-status-header[^"]*"[^>]*>[\s\S]*?<\/div>/s, '');
            // Also remove the divider if it follows
            html = html.replace(/<div[^>]*class="[^"]*sillynpc-status-divider[^"]*"[^>]*><\/div>/s, '');
        }

        // The eye's middle state: the world line without the character rows. Absent means
        // shown, so nothing already saved renders differently for having no opinion.
        if (settings.showCharacters === false) {
            // The mustache block first. It contains the per-character <div>, so once it is
            // gone the wrapper holds no nested div and can be matched to its own closing
            // tag - which is also how any heading somebody put inside it goes with it.
            html = html.replace(/{{#characters}}[\s\S]*?{{\/characters}}/g, '');
            html = html.replace(/<div[^>]*class="[^"]*sillynpc-status-characters[^"]*"[^>]*>[\s\S]*?<\/div>/s, '');
            // And the divider, which now rules off nothing - the same reason the header
            // above takes it when it goes.
            html = html.replace(/<div[^>]*class="[^"]*sillynpc-status-divider[^"]*"[^>]*><\/div>/s, '');
        }
        
        const renderedGlobalCollections = new Set();
        const hiddenGlobalKeys = new Set();
        
        const visibleGlobalStats = [];
        const globalStatsMap = new Map();
        settings.globalStats.forEach(stat => {
            if (!settings.showGlobalStats || stat.visible === false) {
                if (stat.name) {
                    hiddenGlobalKeys.add(stat.name.toLowerCase());
                    html = stripFieldReference(html, stat.name);
                }
            } else {
                visibleGlobalStats.push(stat);
                globalStatsMap.set(stat.name.toLowerCase(), stat);
            }
        });
        
        // A reference is no longer a placement. Every field renders from the list, in
        // the order the builder shows it, so a name typed into a template is a leftover
        // that would otherwise print its caption around nothing.
        visibleGlobalStats.forEach(stat => {
            html = stripFieldReference(html, stat.name);
        });
        html = tidyLeftovers(html);

        // Evaluate conditional blocks for global stats: {{#StatName}}...{{/StatName}}
        html = html.replace(/{{#([\s\S]*?)}}([\s\S]*?){{\/\1}}/g, (match, key, content) => {
            // Only process global keys here (character keys will be in the char template)
            if (key === 'characters') return match; // skip {{#characters}}
            const lowerKey = key.toLowerCase();
            if (hiddenGlobalKeys.has(lowerKey)) return '';
            
            const rawValue = state.global[key] || (globalStatsMap.get(lowerKey)?.defaultValue) || '';
            return rawValue ? content : '';
        });

        if (visibleGlobalStats.length > 0) {
            const globalSet = renderFieldSet(
                visibleGlobalStats,
                (stat) => state.global[stat.name] || stat.defaultValue || '',
                'global');

            if (html.includes('{{globals}}')) {
                // The template says where the set goes.
                html = html.replace(/{{globals}}/g, globalSet);
            } else if (html.includes('sillynpc-status-header')) {
                // No placeholder, so it goes at the end of the header - which is what
                // every template written before this one will do.
                html = html.replace(/(<div[^>]*class="[^"]*sillynpc-status-header[^"]*"[^>]*>)(.*?)(<\/div>)/s,
                    (match, open, content, close) => {
                        const existing = content.trim();
                        const insert = existing ? ' | ' + globalSet : globalSet;
                        return `${open}${content}${insert}${close}`;
                    });
            } else if (html.includes('sillynpc-status-box')) {
                const headerHtml = `<div class="sillynpc-status-header">${globalSet}</div>\n    <div class="sillynpc-status-divider"></div>`;
                html = html.replace(/(<div[^>]*class="[^"]*sillynpc-status-box[^"]*"[^>]*>)/s, `$1\n    ${headerHtml}`);
            } else {
                html = `<div class="sillynpc-status-header">${globalSet}</div>\n<div class="sillynpc-status-divider"></div>\n` + html;
            }

        }

        /* The player's own fields.
         *
         * These had nowhere to go in the chat: the box drew the world line and a row per
         * character, and a player stat was only ever a HUD meter. The Tracker box on each
         * one says whether it belongs here - the same list, the same renderer and the same
         * treatment of a hidden field that the world line already gets.
         *
         * Before the player's collections, which is where the request put them, and that
         * is why this runs first: both this and the collection insert below anchor to the
         * character rows, so whichever goes in last ends up nearer them.
         */
        const visiblePlayerStats = (settings.playerStats || []).filter(stat => stat?.name
            && stat.visible !== false);
        (settings.playerStats || []).forEach(stat => {
            if (stat?.name && stat.visible === false) html = stripFieldReference(html, stat.name);
        });

        if (visiblePlayerStats.length > 0) {
            const playerStatsHtml = renderFieldSet(
                visiblePlayerStats,
                (stat) => {
                    // The stored key can differ in case from the configured name - the same
                    // tolerant match the sheet makes, rather than a lookup that quietly
                    // reads empty for a stat somebody renamed the capitals of.
                    const stats = state.player?.stats || {};
                    const key = Object.keys(stats)
                        .find(k => k.toLowerCase() === stat.name.toLowerCase()) || stat.name;
                    return stats[key] || stat.defaultValue || '';
                },
                'player');

            if (html.includes('{{player}}')) {
                // The template says where the set goes.
                html = html.replace(/{{player}}/g, playerStatsHtml);
            } else {
                const block = `<div class="sillynpc-status-player">${playerStatsHtml}</div>`;
                /* Before the character section, and the wrapper is tried first on purpose.
                   Templates put a heading inside it - "PRESENT CHARACTERS:" and a rule -
                   and anchoring on {{#characters}} lands between that heading and the rows,
                   so the player's fields read as the first character present. Going in
                   ahead of the wrapper puts the heading where it belongs: over the
                   characters it introduces. */
                if (html.includes('sillynpc-status-characters')) {
                    html = html.replace(/(<div[^>]*class="[^"]*sillynpc-status-characters[^"]*"[^>]*>)/s,
                        `${block}\n    $1`);
                } else if (html.includes('{{#characters}}')) {
                    html = html.replace(/(\s*{{#characters}})/, `\n    ${block}$1`);
                } else if (html.includes('sillynpc-status-box')) {
                    html = html.replace(/(<div[^>]*class="[^"]*sillynpc-status-box[^"]*"[^>]*>)/s,
                        `$1\n    ${block}`);
                } else {
                    html += `\n${block}`;
                }
            }
        } else {
            // Nothing to put there, so the placeholder must not survive as text.
            html = html.replace(/{{player}}/g, '');
        }

        // Handle Player Collections in Template
        if (state.player && state.player.collections) {
            for (const [colId, items] of Object.entries(state.player.collections)) {
                const colDef = settings.collections.find(c => c.id === colId);
                if (colDef && colDef.visible === false) continue;

                const colRegex = new RegExp(`{{${escapeRegExp(colId)}}}`, 'g');
                if (html.includes(`{{${colId}}}`)) {
                    const summary = summarizeCollectionUI(colId, items, settings);
                    html = html.replace(colRegex, summary || '');
                    renderedGlobalCollections.add(colId.toLowerCase());
                }
            }
        }

        // Handle missing defined player collections (appended to top or wherever player data is)
        const missingDefinedPlayerCollections = settings.collections.filter(col => 
            (col.target === 'player' || col.target === 'all') && 
            col.visible !== false && 
            !renderedGlobalCollections.has(col.id.toLowerCase())
        );

        if (missingDefinedPlayerCollections.length > 0) {
            const extraPlayerColHtml = missingDefinedPlayerCollections.map(col => {
                const items = (state.player && state.player.collections && state.player.collections[col.id]) || [];
                const summary = summarizeCollectionUI(col.id, items, settings);
                return summary ? ` | ${summary}` : '';
            }).join('');
            
            // Heuristic: Append player collections after player stats if we can find a place,
            // or just to the header/box.
            if (html.includes('sillynpc-status-box')) {
                 // Append before characters section
                 html = html.replace(/({{#characters}})/, (match) => {
                     return extraPlayerColHtml + "\n    " + match;
                 });
            }
        }
        
        /* There used to be a block here that drew an italic row for every key in the state
           that the system did not declare, on the theory that it was surfacing a stat the
           model had invented.

           It could never do that. applyUpdate filters incoming values against the schema
           and refuses anything it does not recognise, so nothing the reader reports can
           reach the state in the first place. What the block actually showed was leftovers:
           a stat deleted in System Builder keeps its stored value, and this drew it forever.
           It was not even editable - the same filter rejected the edit - so the only way to
           be rid of a deleted stat was to un-delete it and untick Visible.

           The system decides what exists. A value the schema no longer declares is not
           drawn, and is not sent to either model either; see statsInSystem. The stored
           value is left where it is rather than erased, so nothing is lost if the stat
           comes back. */

        html = renderCharacters(html, state, settings, renderFieldSet);
        // Cleanup any dangling pipes left by stripped tags
        html = html.replace(/\|\s*\|/g, '|');
        html = html.replace(/\|\s*(<\/div>)/g, '$1');
        html = html.replace(/(<div[^>]*>)\s*\|/g, '$1');

        return html;
    } catch (err) {
        console.error(LOG_PREFIX, 'Error in buildStatusHtml', err);
        return '';
    }
}
