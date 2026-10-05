"""Read-only settings navigation and search checks in local SillyTavern."""
import time
from ui_webdriver import browser_session


with browser_session() as browser:
    execute = browser.execute
    execute("document.querySelector('#sillynpc-open-manage').click()")
    time.sleep(0.5)
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
    browser.resize(600, 900)
    assert execute("""const rail = document.querySelector('.sillynpc-tabs');
        return rail.scrollWidth <= rail.clientWidth + 2;""")
    print('Settings navigation passed: eight sections, separate Lorebook/Images, search, narrow layout')
