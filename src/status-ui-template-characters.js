import { escapeHtml, escapeRegExp } from './utils.js';
import { LOG_PREFIX } from './constants.js';
import { summarizeCollectionUI, buildPortraitHtml, stripFieldReference, tidyLeftovers, joinTo } from './status-ui-template-core.js';

export function renderCharacters(html, state, settings, renderFieldSet) {

    const charMatch = html.match(/{{#characters}}([\s\S]*?){{\/characters}}/);
    if (charMatch) {
        let charTemplate = charMatch[1].trim() || '';
        let charsHtml = '';
        
        const hiddenCharKeys = new Set();
        const visibleCharStats = [];
        
        settings.npcStats.forEach(stat => {
            if (stat.visible === false) {
                if (stat.name) {
                    hiddenCharKeys.add(stat.name.toLowerCase());
                    charTemplate = stripFieldReference(charTemplate, stat.name);
                }
            } else {
                visibleCharStats.push(stat);
            }
        });

        // On the template, before anything is put into it.
        //
        // Neither step looks at the character - they only take field references out of
        // the layout - and running them per row meant tidyLeftovers saw the remove
        // button and the portrait. Its "drop an inline element with nothing in it"
        // rule then deleted the button, because a Font Awesome icon is exactly that:
        // an empty <i>. Doing it here also does it once instead of once per character.
        visibleCharStats.forEach(stat => {
            charTemplate = stripFieldReference(charTemplate, stat.name);
        });
        charTemplate = tidyLeftovers(charTemplate);

        state.characters.forEach((char, index) => {
            try {
                let charRow = charTemplate;
                const removeBtnHtml = `<i class="sillynpc-char-remove fa-solid fa-minus" data-name="${escapeHtml(char.name)}" title="Remove ${escapeHtml(char.name)} from scene" style="cursor: pointer; opacity: 0.5; margin-right: 4px; font-size:var(--sillynpc-text-sm); z-index: 2; position: relative;"></i>`;
                
                if (/(<[^>]+>)/.test(charRow)) {
                    charRow = charRow.replace(/(<[^>]+>)/, `$1${removeBtnHtml}`);
                } else {
                    charRow = removeBtnHtml + charRow;
                }
                
                // Portraits are resolved before {{name}} is substituted, so the
                // implicit placement below can still find the token.
                if (charTemplate.includes('{{portrait}}')) {
                    charRow = charRow.replace(/{{portrait}}/g, buildPortraitHtml(char.name));
                } else if (settings.showNpcPortraits) {
                    // Templates written before portraits existed get one in front of
                    // the name, so the feature works without editing the template.
                    charRow = charRow.replace(/{{name}}/, buildPortraitHtml(char.name) + '{{name}}');
                }

                // Always ensure name is replaced
                charRow = charRow.replace(/{{name}}/g, escapeHtml(char.name));
                
                const renderedCharCollections = new Set();

                if (visibleCharStats.length > 0) {
                    const fieldSet = renderFieldSet(
                        visibleCharStats,
                        (stat) => (char.stats && char.stats[stat.name]) || stat.defaultValue || '',
                        'character', index);

                    if (charRow.includes('{{fields}}')) {
                        // The template says where the set goes.
                        charRow = charRow.replace(/{{fields}}/g, fieldSet);
                    } else if (/(<\/div>\s*)$/.test(charRow)) {
                        // Before the trailing whitespace and </div>, or SillyTavern
                        // adds a <br> where the row used to end.
                        charRow = charRow.replace(/(\s*)(<\/div>\s*)$/, (match, space, div) => {
                            const upTo = charRow.slice(0, charRow.length - match.length);
                            return joinTo(upTo) + fieldSet + space + div;
                        });
                    } else {
                        charRow = charRow.trim() + joinTo(charRow) + fieldSet;
                    }

                }

                // Handle Character Collections in Template
                if (char.collections) {
                    for (const [colId, items] of Object.entries(char.collections)) {
                        const colDef = settings.collections.find(c => c.id === colId);
                        if (colDef && colDef.visible === false) continue;

                        const colRegex = new RegExp(`{{${escapeRegExp(colId)}}}`, 'g');
                        if (charTemplate.includes(`{{${colId}}}`)) {
                            const summary = summarizeCollectionUI(colId, items, settings);
                            charRow = charRow.replace(colRegex, summary || '');
                            renderedCharCollections.add(colId.toLowerCase());
                        }
                    }
                }

                // Handle missing defined collections
                const missingDefinedCharCollections = settings.collections.filter(col => 
                    (col.target === 'npc' || col.target === 'all') && 
                    col.visible !== false && 
                    !renderedCharCollections.has(col.id.toLowerCase())
                );

                if (missingDefinedCharCollections.length > 0) {
                    const extraColHtml = missingDefinedCharCollections.map(col => {
                        const items = (char.collections && char.collections[col.id]) || [];
                        const summary = summarizeCollectionUI(col.id, items, settings);
                        return summary ? ` | ${summary}` : '';
                    }).join('');

                    if (/(<\/div>\s*)$/.test(charRow)) {
                        charRow = charRow.replace(/(\s*)(<\/div>\s*)$/, (match, space, div) => {
                            return extraColHtml + space + div;
                        });
                    } else {
                        charRow = charRow.trim() + extraColHtml;
                    }
                }

                charRow = charRow.replace(/{{#([\s\S]*?)}}([\s\S]*?){{\/\1}}/g, (match, key, content) => {
                    if (hiddenCharKeys.has(key.toLowerCase())) return '';
                    return (char.stats && char.stats[key] || '') ? content : '';
                });
                
                charsHtml += charRow;
            } catch (charErr) {
                console.error(LOG_PREFIX, 'Error building status HTML for char', char, charErr);
            }
        });
        
        html = html.replace(charMatch[0], charsHtml);
    }
    return html;
}
