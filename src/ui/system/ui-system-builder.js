import { liveSystemContext } from './ui-system-context.js';
import { buildProgressionEditor } from './ui-system-progression.js';
import { buildNpcTemplatesEditor } from './ui-npc-templates.js';
import { makeActivatable } from '../../core/utils.js';
import { buildCollectionsEditor } from './ui-system-collections.js';
import { buildStatsEditor } from './ui-system-stats.js';
import { buildProfilesEditor } from './ui-system-profiles.js';

/**
 * System Builder: the stats, collections and fields a System is made of.
 *
 * Split out of status-settings.js. Editing what a System contains is a different job from
 * saving, restoring and swapping whole Systems, which is System Manager's.
 */

let systemBuilderActiveTab = 'global';

export function buildSystemBuilder(onRefresh, context = liveSystemContext) {
    let activeTab = context === liveSystemContext ? systemBuilderActiveTab : (context.builderActiveTab || 'global');
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-system-builder';
    wrap.style.border = '1px solid var(--sillynpc-border)';
    wrap.style.borderRadius = '8px';
    wrap.style.overflow = 'hidden';

    const tabs = document.createElement('div');
    tabs.style.display = 'flex';
    tabs.style.flexWrap = 'wrap';
    tabs.style.background = 'var(--sillynpc-bg-secondary)';
    tabs.style.borderBottom = '1px solid var(--sillynpc-border)';
    tabs.setAttribute('role', 'tablist');

    const content = document.createElement('div');
    content.style.padding = '15px';

    const tabList = [
        { id: 'global', label: 'Global' },
        { id: 'npc', label: 'NPC Stats' },
        { id: 'npc-profile', label: 'NPC Profile' },
        { id: 'npc-templates', label: 'NPC Templates' },
        { id: 'player', label: 'Player Stats' },
        { id: 'player-profile', label: 'Player Profile' },
        { id: 'collections', label: 'Collections' }
    ];

    const renderTabs = () => {
        tabs.replaceChildren();
        tabList.forEach(tab => {
            const btn = document.createElement('div');
            btn.textContent = tab.label;
            btn.style.padding = '8px 15px';
            btn.style.cursor = 'pointer';
            btn.style.flex = '1 1 105px';
            btn.style.textAlign = 'center';
            if (activeTab === tab.id) {
                // A white wash, which is no wash at all on the light themes - the open tab
                // there was indistinguishable from the two beside it. Mixed from the text
                // colour instead, so it darkens a light theme and lightens a dark one.
                btn.style.background = 'color-mix(in srgb, currentColor 12%, transparent)';
                btn.style.fontWeight = 'bold';
            }
            makeActivatable(btn, { role: 'tab' });
            btn.addEventListener('click', () => {
                activeTab = tab.id;
                context.builderActiveTab = tab.id;
                if (context === liveSystemContext) systemBuilderActiveTab = tab.id;
                renderTabs();
                renderContent();
            });
            tabs.appendChild(btn);
        });
    };

    const renderContent = () => {
        content.replaceChildren();
        if (activeTab === 'global') {
            content.appendChild(buildStatsEditor('Global Stats', 'globalStats', onRefresh, context));
        } else if (activeTab === 'npc-templates') {
            content.appendChild(buildNpcTemplatesEditor(onRefresh, context));
        } else if (activeTab === 'npc') {
            content.appendChild(buildStatsEditor('NPC Stats', 'npcStats', onRefresh, context));
        } else if (activeTab === 'player') {
            content.appendChild(buildStatsEditor('Player Stats', 'playerStats', onRefresh, context));
            content.appendChild(buildProgressionEditor({ onRefresh, context }));
        } else if (activeTab === 'npc-profile') {
            content.appendChild(buildProfilesEditor('npc', onRefresh, context));
        } else if (activeTab === 'player-profile') {
            content.appendChild(buildProfilesEditor('player', onRefresh, context));
        } else if (activeTab === 'collections') {
            content.appendChild(buildCollectionsEditor(onRefresh, context));
        }
    };

    renderTabs();
    renderContent();
    wrap.append(tabs, content);
    return wrap;
}
