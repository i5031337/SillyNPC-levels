import { getExtractionReport } from '../extractor/status-extraction-report.js';
import { getSettings } from '../../core/settings.js';
import { getContext } from '../../../../../../st-context.js';
import { trackerMessageIndex } from './status-ui-placement.js';
import { getSwipeBase } from '../status-logic.js';

const labels = {
    why: 'Reasons given by the reader',
    global: 'World', player: 'Player', characters: 'Characters',
    stats: 'Stats', collections: 'Collections',
    strangers: 'New characters', profile: 'Profile',
};

function labelFor(key) {
    return labels[key] || String(key).replace(/_/g, ' ');
}

/** Render arbitrary reader fields as nested labels and values, never as executable HTML. */
function appendValue(parent, key, value) {
    const row = document.createElement('div');
    row.className = 'sillynpc-reader-row';
    const label = document.createElement('strong');
    label.textContent = labelFor(key);
    row.appendChild(label);
    if (value && typeof value === 'object') {
        const entries = Array.isArray(value)
            ? value.map((item, index) => item && typeof item === 'object' && item.name
                ? [String(item.name), Object.fromEntries(Object.entries(item).filter(([name]) => name !== 'name'))]
                : [`Entry ${index + 1}`, item])
            : Object.entries(value);
        if (entries.length) {
            const children = document.createElement('div');
            children.className = 'sillynpc-reader-children';
            for (const [name, item] of entries) appendValue(children, name, item);
            row.appendChild(children);
        } else {
            const empty = document.createElement('span');
            empty.textContent = Array.isArray(value) ? 'None' : 'Empty';
            row.appendChild(empty);
        }
    } else {
        const text = document.createElement('span');
        text.textContent = value == null ? 'None' : String(value);
        row.appendChild(text);
    }
    parent.appendChild(row);
}

/** One message's reader status and complete model reply. Visible without console access. */
export function renderExtractionReport(mesEl, messageId) {
    if (!mesEl) return;
    const previous = mesEl.querySelector('.sillynpc-reader-report');
    const wasOpen = previous?.querySelector('details')?.open;
    previous?.remove();
    if (!getSettings().enabled) return;
    const showOutput = getSettings().statusTracker.showRawTrackerOutput !== false;
    const rewardFailures = getContext()?.chat?.[Number(messageId)]?.extra?.sillynpc_level_reading?.failures?.length;
    const report = getExtractionReport(messageId);
    if (!report) return;
    if (!showOutput && !rewardFailures && !report.warnings?.length) return;

    const panel = document.createElement('div');
    panel.className = `sillynpc-reader-report sillynpc-theme-${getSettings().menuStyle || 'default'}`;
    if (report.status === 'running') {
        panel.classList.add('sillynpc-reader-running');
        panel.setAttribute('role', 'status');
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-spinner fa-spin';
        icon.setAttribute('aria-hidden', 'true');
        panel.append(icon, document.createTextNode(' Tracker reading this reply…'));
    } else {
        const details = document.createElement('details');
        details.open = Boolean(wasOpen);
        const summary = document.createElement('summary');
        const diagnostics = String(report.summary || '').split(' · ')
            .filter(part => !/^\d+ (applied|awaiting review)$/.test(part)).join(' · ');
        summary.textContent = report.status === 'failed'
            ? `Tracker reading failed · ${report.summary}`
            : `Tracker reading complete · Applied: ${report.breakdown.applied} · Needs review: ${report.breakdown.pending}`
                + (diagnostics ? ` · ${diagnostics}` : '');
        details.appendChild(summary);
        if (report.breakdown?.rows.length) {
            const table = document.createElement('table');
            table.className = 'sillynpc-reader-breakdown';
            const heading = table.createTHead().insertRow();
            for (const label of ['Who', 'Applied', 'Needs review']) {
                const cell = document.createElement('th');
                cell.scope = 'col';
                cell.textContent = label;
                heading.appendChild(cell);
            }
            const body = table.createTBody();
            for (const row of report.breakdown.rows) {
                const tr = body.insertRow();
                for (const value of [row.target, row.applied, row.pending]) tr.insertCell().textContent = value;
            }
            details.appendChild(table);
        }
        if (report.warnings?.length) {
            const warnings = document.createElement('div');
            warnings.className = 'sillynpc-review-loose-notes sillynpc-reader-warnings';
            const heading = document.createElement('strong');
            heading.textContent = 'Skipped or adjusted changes';
            warnings.appendChild(heading);
            for (const warning of report.warnings) {
                const line = document.createElement('div');
                line.textContent = warning;
                warnings.appendChild(line);
            }
            details.appendChild(warnings);
        }
        const content = document.createElement('div');
        content.className = 'sillynpc-reader-content';
        if (report.output && typeof report.output === 'object') {
            const entries = Object.entries(report.output);
            // Put the explanation first; the rest follows in the reader's own order.
            entries.sort(([a], [b]) => (b === 'why') - (a === 'why'));
            for (const [key, value] of entries) appendValue(content, key, value);
        } else if (report.output != null) {
            const text = document.createElement('div');
            text.className = 'sillynpc-reader-raw';
            text.textContent = String(report.output);
            content.appendChild(text);
        } else {
            content.textContent = 'The reader returned no output.';
        }
        if (showOutput) details.appendChild(content);
        if (Number(messageId) === trackerMessageIndex(getContext()?.chat || [])
            && (report.status === 'failed' || getSwipeBase(messageId))) {
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'menu_button sillynpc-reader-retry';
            const missingRewards = getContext()?.chat?.[Number(messageId)]?.extra?.sillynpc_level_reading?.failures?.length;
            retry.textContent = missingRewards ? 'Retry missing level-up rewards'
                : report.status === 'failed' ? 'Retry tracker reading' : 'Regenerate tracker reading';
            retry.addEventListener('click', async () => {
                const message = getContext()?.chat?.[Number(messageId)];
                if (!message || Number(messageId) !== trackerMessageIndex(getContext()?.chat || [])) return;
                retry.disabled = true;
                const { extractStateFromMessage } = await import('../extractor/status-extractor-run.js');
                try {
                    if (message.extra?.sillynpc_level_reading?.failures?.length) {
                        const { retryLevelReading } = await import('../extractor/status-level-reading.js');
                        const result = await retryLevelReading(messageId);
                        if (result.applied) {
                            message.extra.sillynpc_reader_report.summary = '0 applied · 0 awaiting review'
                                + (result.failures ? ` · ${result.failures} choices still failed` : '');
                            renderExtractionReport(mesEl, messageId);
                        }
                    } else await extractStateFromMessage(message.mes, messageId, {
                        manual: true, regenerate: Boolean(getSwipeBase(messageId)),
                    });
                } finally {
                    retry.disabled = false;
                }
            });
            details.appendChild(retry);
        }
        panel.appendChild(details);
    }
    // Keep diagnostics outside story text: the inline status parser reads .mes_text.
    const text = mesEl.querySelector('.mes_text');
    if (text) text.after(panel);
    else mesEl.appendChild(panel);
}
