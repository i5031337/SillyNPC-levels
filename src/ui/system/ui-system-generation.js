import { buildDraftDetails } from './ui-draft-details.js';
import { getSettings } from '../../core/settings.js';
import { getContext } from '../../../../../../st-context.js';
import { importSystemPreset } from '../../tracker/status-logic.js';
import { SystemGenerationRun } from '../../generation/generate-system.js';
import { generationRequestAdapter } from '../../generation/request.js';
import { createDraftContext } from '../../generation/draft-context.js';
import { finalizeDefinition } from '../../generation/validate-definition.js';
import { buildSystemBuilder } from './ui-system-builder.js';

const button = (label, className, action) => {
    const element = document.createElement('button'); element.type = 'button';
    element.className = `menu_button ${className}`; element.textContent = label;
    element.addEventListener('click', action); return element;
};
function labeled(parent, title, tag, className) {
    const label = document.createElement('label'); label.textContent = title;
    const input = document.createElement(tag); input.className = `text_pole ${className}`;
    input.setAttribute('aria-label', title); label.append(input); parent.append(label); return input;
}
/** The only write boundary: validate again and reject collisions rather than replace. */
export function saveGeneratedSystem(definition, name, { presets = getSettings().statusTracker.presets || {}, save = importSystemPreset } = {}) {
    name = name.trim();
    if (!name || name.length > 120 || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Choose a valid, distinct System name.');
    if (Object.hasOwn(presets, name)) throw new Error(`A System called “${name}” already exists. Choose another name.`);
    const result = finalizeDefinition({ ...definition, name });
    if (result.errors.length) throw new Error(result.errors.join('\n'));
    return save(JSON.stringify(result.definition));
}
/** Inline dialog with an explicit local draft; injectable requests/save boundary for smoke checks. */
export function buildSystemGeneration(onSaved = () => {}, { requestFactory, save = saveGeneratedSystem } = {}) {
    const wrap = document.createElement('section'); wrap.className = 'sillynpc-system-generation';
    wrap.setAttribute('aria-label', 'Generate System from premise');
    const title = document.createElement('h3'); title.textContent = 'Generate from premise'; wrap.append(title);
    const note = document.createElement('p'); note.textContent = 'Describe the game you want to play. Generation builds a draft in several small steps. Review and edit it before saving a new System. Retry keeps the original premise and connection; Regenerate uses the current inputs.'; wrap.append(note);
    const name = labeled(wrap, 'System name (optional until saving)', 'input', 'gen-name'); name.maxLength = 120;
    const premise = labeled(wrap, 'Game or roleplay premise', 'textarea', 'gen-premise'); premise.rows = 4; premise.maxLength = 8000;
    const constraints = labeled(wrap, 'Preferences (tone, complexity, resources, progression)', 'textarea', 'gen-constraints'); constraints.rows = 2; constraints.maxLength = 4000;
    const connection = labeled(wrap, 'Generation connection', 'select', 'gen-connection');
    const main = document.createElement('option'); main.value = ''; main.textContent = 'Main API (same as chat)'; connection.append(main);
    const reader = getSettings().statusTracker;
    let profiles = [];
    try { profiles = getContext().ConnectionManagerRequestService?.getSupportedProfiles() || []; } catch { /* keep explicit main option */ }
    for (const profile of profiles) {
        const opt = document.createElement('option'); opt.value = profile.id; opt.textContent = profile.name || profile.id; connection.append(opt);
    }
    if (reader.extractionProfileId && !profiles.some(p => p.id === reader.extractionProfileId)) {
        const opt = document.createElement('option'); opt.value = reader.extractionProfileId;
        opt.textContent = `Reader connection unavailable (${reader.extractionProfileId})`; connection.append(opt);
    }
    connection.value = reader.extractionProfileId || '';
    const status = document.createElement('p'); status.className = 'gen-progress'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const errors = document.createElement('pre'); errors.className = 'gen-errors'; errors.setAttribute('role', 'alert');
    const summary = document.createElement('div'); summary.className = 'gen-summary';
    const editor = document.createElement('div'); editor.className = 'gen-editor';
    const actions = document.createElement('div'); actions.className = 'gen-actions';
    let run = null, controller = null, draft = null, context = null, closed = false, busy = false;
    const showErrors = list => { errors.textContent = list.slice(0, 40).join('\n'); errors.hidden = !list.length; };
    const valid = () => {
        if (!run?.complete || !draft || busy) return false;
        const result = finalizeDefinition(draft); showErrors(result.errors);
        return !result.errors.length;
    };
    const updateSave = () => { saveButton.disabled = !valid(); };
    const displaySummary = () => {
        summary.replaceChildren();
        if (!draft) return;
        const text = document.createElement('p');
        text.textContent = `${draft.name}: ${draft.metadata.description}`; summary.append(text);
        const list = document.createElement('ul');
        const playerPending = !run.complete && run.plan?.playerProgression.enabled && !run.accepted.has('stats.player');
        const lines = [
            `Player progression: ${playerPending ? 'pending' : draft.progression.player.enabled ? `${draft.progression.player.pointsPerLevel} skill points per level (${draft.progression.player.assignment})` : 'disabled'}`,
            ...draft.npcTemplates.map(t => {
                const pending = !run.complete && run.plan?.npcTemplates.find(p => p.id === t.id)?.progression.enabled && !run.accepted.has('stats.npc');
                return `${t.name}: ${t.statIds.length} stats, ${t.profileIds.length} profile fields; progression ${pending ? 'pending' : t.progression?.enabled ? 'enabled' : 'disabled'}. ${t.description}`;
            }),
            ...draft.collections.map(c => `${c.name}: ${c.targets.join(', ')}; rewards ${c.levelUpRewards?.enabled ? `${c.levelUpRewards.mode} (${c.levelUpRewards.schedule.length} scheduled entries, guided interval ${c.levelUpRewards.interval})` : 'disabled'}.`),
            ...run.allAssumptions(),
        ];
        for (const line of lines) { const li = document.createElement('li'); li.textContent = line; list.append(li); }
        summary.append(list);
    };
    const renderEditor = () => {
        editor.replaceChildren();
        if (context) editor.append(buildDraftDetails(context), buildSystemBuilder(renderEditor, context));
    };
    const setBusy = value => {
        busy = value;
        for (const input of [name, premise, constraints, connection]) input.disabled = value;
        generate.disabled = value; retry.disabled = value; edit.disabled = value || !run?.complete;
        saveButton.disabled = value || !run?.complete;
        wrap.setAttribute('aria-busy', String(value));
    };
    const perform = async fresh => {
        if (busy || closed) return;
        if (fresh) {
            controller?.abort();
            try {
                const preferences = getSettings().statusTracker;
                const captured = { extractionProfileId: preferences.extractionProfileId,
                    extractionUseSchema: preferences.extractionUseSchema, extractionTemperature: preferences.extractionTemperature };
                const request = requestFactory ? requestFactory(connection.value) : generationRequestAdapter(captured, connection.value);
                run = new SystemGenerationRun({ premise: premise.value, name: name.value, constraints: constraints.value, request,
                    onProgress: progress => {
                        if (closed) return;
                        status.textContent = `${progress.stage}${progress.total ? `: ${progress.index} of ${progress.total}` : ''}${progress.repair ? ' (repairing)' : ''}. ${progress.usage.requests} requests.`;
                    } });
                context = null; draft = null; editor.replaceChildren(); summary.replaceChildren();
                generate.textContent = 'Regenerate';
            } catch (error) { showErrors([error.message]); return; }
        }
        if (!run) return;
        controller = new AbortController(); setBusy(true); showErrors([]); retry.hidden = true;
        try {
            const result = await run.generate({ signal: controller.signal });
            if (closed || controller.signal.aborted) return;
            draft = result.definition;
            if (!name.value.trim()) name.value = draft.name;
            context = createDraftContext(draft, changed => { draft = changed; displaySummary(); updateSave(); });
            displaySummary();
            status.textContent = `Draft ready. ${result.usage.requests} requests; approximately ${Math.round((result.usage.promptChars + result.usage.replyChars) / 4).toLocaleString()} tokens across all steps. Review before saving.`;
            generate.textContent = 'Regenerate';
        } catch (error) {
            if (closed) return;
            status.textContent = error.name === 'AbortError' ? 'Generation cancelled. Completed sections are kept for retry.' : 'Generation paused. Completed sections are kept.';
            if (error.name !== 'AbortError') showErrors([error.message]);
            retry.hidden = !run || run.complete;
            if (run.definition) {
                draft = structuredClone(run.definition); displaySummary();
            }
        } finally {
            if (!closed) { setBusy(false); if (run.complete) updateSave(); }
        }
    };
    const generate = button('Generate', 'gen-generate', () => perform(true));
    const retry = button('Retry unfinished section', 'gen-retry', () => perform(false)); retry.hidden = true;
    const edit = button('Edit draft', 'gen-edit', () => { renderEditor(); editor.querySelector('[role="tab"]')?.focus(); }); edit.disabled = true;
    const saveButton = button('Save as new System', 'gen-save', () => {
        if (!valid()) return;
        try {
            save(draft, name.value); onSaved(name.value.trim());
            status.textContent = `Saved “${name.value.trim()}”. Select it from Systems when you are ready to start an adventure.`;
            context = null; run.complete = false; edit.disabled = true; saveButton.disabled = true; editor.replaceChildren();
        } catch (error) { showErrors([error.message]); }
    }); saveButton.disabled = true;
    const cancel = button('Cancel', 'gen-cancel', () => {
        if (busy) { controller?.abort(); return; }
        closed = true; observer.disconnect(); wrap.remove();
    });
    const observer = new MutationObserver(() => {
        if (!wrap.isConnected) { closed = true; controller?.abort(); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    actions.append(generate, retry, edit, saveButton, cancel);
    wrap.append(actions, status, errors, summary, editor); errors.hidden = true;
    return wrap;
}
