"""Read-only settings navigation and search checks in local SillyTavern."""
import time
from ui_webdriver import browser_session


with browser_session() as browser:
    execute = browser.execute
    execute("document.querySelector('#sillynpc-open-manage').click()")
    time.sleep(0.5)
    assert execute("return !document.querySelector('.sillynpc-tabs .sillynpc-subtabs')")
    execute("document.querySelector('.sillynpc-subtabs [data-tab=player]').click()")
    assert execute("return !!document.querySelector('#sillynpc-player-view').children.length")
    execute("document.querySelector('.sillynpc-section[data-section=images]').click()")
    assert execute("return !!document.querySelector('#sillynpc-image-settings-view').children.length")
    execute("document.querySelector('.sillynpc-section[data-section=dialogue]').click()")
    assert execute("return !!document.querySelector('#sillynpc-writing-view').children.length")
    assert execute("""return [...document.querySelectorAll('.sillynpc-section')]
        .map(button => button.textContent.trim());""") == [
        'Cast', 'System', 'Dialogue', 'Tracker', 'Lorebook', 'Images', 'Appearance', 'Extension'
    ]
    for section, key, excluded in [
        ('lorebook', 'defaultLorebook', 'autoPortraitOnFill'),
        ('images', 'autoPortraitOnFill', 'defaultLorebook'),
    ]:
        execute(f"document.querySelector('.sillynpc-section[data-section={section}]').click()")
        assert execute(f"""const panel = document.querySelector('[data-panel={section}]');
            return !!panel.querySelector('[data-setting={key}]')
                && !panel.querySelector('[data-setting={excluded}]')
                && panel.getAttribute('aria-labelledby') === 'sillynpc-section-{section}'
                && document.querySelector('.sillynpc-subtabs').hidden;""")
    for query, section, key in [
        ('Default Target Lorebook', 'lorebook', 'defaultLorebook'),
        ('Draw Portrait Automatically', 'images', 'autoPortraitOnFill'),
    ]:
        execute(f"""const input = document.querySelector('#sillynpc-settings-search input');
            input.value = '{query}'; input.dispatchEvent(new Event('input', {{bubbles: true}}));""")
        assert execute(f"""return document.querySelector('.sillynpc-settings-search-where')
            ?.textContent === '{section.capitalize()}';""")
        execute("document.querySelector('.sillynpc-settings-search-hit').click()")
        assert execute(f"""return document.querySelector('.sillynpc-section.active')
            ?.dataset.section === '{section}'
            && !!document.querySelector('[data-panel={section}] [data-setting={key}]');""")
    execute("document.querySelector('.sillynpc-section[data-section=systems]').click()")
    system_nav = execute("""return {
        section: document.querySelector('.sillynpc-section.active')?.textContent.trim(),
        page: document.querySelector('.sillynpc-subtabs .sillynpc-tab.active:not([hidden])')?.dataset.tab || document.querySelector('.sillynpc-section.active')?.dataset.tab,
        subtabsHidden: document.querySelector('.sillynpc-subtabs')?.hidden,
        panelLabel: document.querySelector('[data-panel=systems]')?.getAttribute('aria-labelledby'),
        builderVisible: !!document.querySelector('.sillynpc-system-builder')};""")
    assert system_nav == {'section': 'System', 'page': 'systems', 'subtabsHidden': True,
                          'panelLabel': 'sillynpc-section-systems', 'builderVisible': True}, system_nav
    execute("""const input = document.querySelector('#sillynpc-settings-search input');
        input.value = 'Speech Block Dividers'; input.dispatchEvent(new Event('input', {bubbles: true}));""")
    execute("document.querySelector('.sillynpc-settings-search-hit').click()")
    search_result = execute("""return {
        section: document.querySelector('.sillynpc-section.active')?.dataset.section,
        detailsOpen: document.querySelector('[data-setting=dividerStyle]')?.closest('details')?.open,
        activePage: document.querySelector('.sillynpc-subtabs .sillynpc-tab.active:not([hidden])')?.dataset.tab || document.querySelector('.sillynpc-section.active')?.dataset.tab};""")
    assert execute("return !!document.querySelector('#sillynpc-appearance-view #sillynpc-hud-view [data-setting]')")
    assert search_result == {'section': 'appearance', 'detailsOpen': True,
                             'activePage': 'appearance'}, search_result
    execute("document.querySelector('.sillynpc-section[data-section=more]').click()")
    more = execute("""return {
        page: document.querySelector('.sillynpc-subtabs .sillynpc-tab.active:not([hidden])')?.dataset.tab || document.querySelector('.sillynpc-section.active')?.dataset.tab,
        subtabsHidden: document.querySelector('.sillynpc-subtabs')?.hidden};""")
    assert more == {'page': 'advanced', 'subtabsHidden': True}, more
    assert execute("return !!document.querySelector('#sillynpc-advanced-view #sillynpc-stats-view h3')")
    browser.resize(600, 900)
    execute("document.querySelector('.sillynpc-section[data-section=status]').click()")
    narrow = execute("""const tabs = document.querySelector('.sillynpc-tabs');
        return {overflow: tabs.scrollWidth > tabs.clientWidth + 2,
          visiblePages: [...document.querySelectorAll('.sillynpc-subtabs .sillynpc-tab')]
            .filter(tab => !tab.hidden).length};""")
    assert narrow == {'overflow': False, 'visiblePages': 0}, narrow
    print('Settings navigation passed: eight sections, separate Lorebook/Images, search, narrow layout')
