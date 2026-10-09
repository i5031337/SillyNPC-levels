const STORAGE_KEY = 'sillynpc-profile-sections';
let openSections = {};
try { openSections = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; }
catch { /* Keep section choices in memory when browser storage is unavailable. */ }

/** Shared reading preferences, independent of the character or chat being viewed. */
export function buildProfileSection(key, title, { open = false, count } = {}) {
    const section = document.createElement('details');
    section.className = 'sillynpc-profile-section';
    section.dataset.sectionKey = key;
    section.open = typeof openSections[key] === 'boolean' ? openSections[key] : open;
    let lastOpen = section.open;
    const summary = document.createElement('summary');
    const body = document.createElement('div');
    body.className = 'sillynpc-profile-section-body';
    const setTitle = (title, count) => {
        summary.textContent = count === undefined ? title : `${title} · ${count}`;
    };
    setTitle(title, count);
    section.append(summary, body);
    section.addEventListener('toggle', () => {
        if (!section.isConnected || section.open === lastOpen) return;
        lastOpen = section.open;
        openSections[key] = section.open;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(openSections)); }
        catch { /* The current session still remembers the choice. */ }
    });
    return { section, body, setTitle };
}
