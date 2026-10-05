import { getSettings, saveSettings, defaultSettings } from '../../core/settings.js';
import { Popup } from '../../../../../../popup.js';
import { buildTokenReadout } from '../../core/tokens.js';
import { appendSettingHelp } from './ui-setting-help.js';

function getNestedValue(obj, path) {
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

function setNestedValue(obj, path, value) {
    const parts = path.split('.');
    const last = parts.pop();
    const target = parts.reduce((acc, part) => acc && acc[part], obj);
    if (target) target[last] = value;
}

/**
 * Hides a control that is only worth touching for a reason, unless dev mode is on.
 *
 * Hidden rather than removed, and hidden rather than never built: it stays in the page so
 * the checks that ask what a tab offers keep seeing it, and so turning dev mode on is a
 * redraw rather than a reload.
 *
 * @param {HTMLElement} wrap
 * @param {{ advanced?: boolean }} spec
 */
function markAdvanced(wrap, spec) {
    if (!spec?.advanced) return;
    wrap.dataset.advanced = 'true';
    if (!getSettings().devMode) wrap.style.display = 'none';
}

/**
 * Which settings object a control reads and writes.
 *
 * These builders carry the label, the help text, the advanced gating and the saving, which
 * is why every settings surface here is made of them - and why an addon wants them too. But
 * they read SillyNPC's own settings by name, so an addon using them as they stood would
 * write its settings into this extension's file.
 *
 * An optional store is the whole of the fix. Omitted, which is every existing call, it is
 * exactly what it always was; supplied, the control belongs to somebody else entirely. The
 * alternative was a second copy of five builders, and two copies of a control that saves is
 * how the two stop agreeing about what saving means.
 *
 * Dev mode is deliberately not part of it: "show me the advanced controls" is one decision
 * about one person's screen, not a per-extension preference.
 *
 * defaults comes with it because the slider and number controls fall back to the schema
 * default for their key when nothing is stored - and reading SillyNPC's schema for somebody
 * else's key finds nothing, which puts a slider at its minimum rather than where the addon
 * says it starts.
 *
 * @param {{ store?: { get: () => object, save: () => void, defaults?: object } }} [options]
 * @returns {{ read: () => object, write: () => void, defaults: object }}
 */
function storeOf(options) {
    return {
        read: options?.store?.get ?? getSettings,
        write: options?.store?.save ?? saveSettings,
        defaults: options?.store?.defaults ?? defaultSettings,
    };
}
/**
 * @param {object} options
 * @param {string} [options.recommended] Adds a control that restores this text.
 *   A customised template silently keeps working while the recommended one moves on -
 *   the [FACTS] placeholder was added to the lore default and never reached anyone who
 *   had edited theirs, with nothing in the panel to say so.
 * @param {boolean} [options.showTokens] Adds a live token count under the box. What a
 *   prompt costs is decided when you write it, so it belongs where you write it - not
 *   discovered later from a bill. Counts the template as typed; the placeholders are
 *   filled at send time and cost whatever they are filled with.
 * @param {string} [options.emptyNote] Shown instead of a count when the box is empty,
 *   for the settings where empty means something other than "send nothing".
 */
export function buildSettingTextArea(options) {
    const { key, label, help, onChange, recommended, showTokens = false, emptyNote = '', builtIn } = options;
    const { read, write } = storeOf(options);
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    // Says which setting this is, so a control can be found by what it writes rather
    // than by where it happens to be drawn - which is what a rearrangement changes.
    wrap.dataset.setting = key;
    markAdvanced(wrap, options);

    const text = document.createElement('label');
    text.className = 'sillynpc-setting-row';
    text.style.fontWeight = 'bold';
    text.textContent = label;
    wrap.append(text);

    const textarea = document.createElement('textarea');
    textarea.className = 'text_pole sillynpc-setting-textarea';
    textarea.rows = options.rows ?? 6;
    textarea.style.marginTop = '6px';
    /* A setting whose empty value means "the built-in wording" shows that wording rather than
       an empty box - an empty box reads as "nothing is sent", which is the opposite. It is
       stored as empty while it matches, so an improved built-in text still reaches you. */
    const stored = (value) => (builtIn !== undefined && value.trim() === String(builtIn).trim() ? '' : value);
    const shown = getNestedValue(read(), key) ?? '';
    textarea.value = builtIn !== undefined && !String(shown).trim() ? builtIn : shown;
    const tokens = showTokens
        ? buildTokenReadout(() => textarea.value, { note: emptyNote })
        : null;

    textarea.addEventListener('input', () => {
        setNestedValue(read(), key, stored(textarea.value));
        write();
        tokens?.refresh();
        onChange?.();
    });
    if (builtIn !== undefined) {
        textarea.addEventListener('blur', () => {
            if (textarea.value.trim()) return;
            textarea.value = builtIn;
            tokens?.refresh();
        });
    }
    wrap.append(textarea);
    if (tokens) wrap.append(tokens.element);

    appendSettingHelp(wrap, help);

    if (recommended) {
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'menu_button sillynpc-restore-recommended';
        restore.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Restore recommended';
        restore.title = 'Replace this with the recommended template.';
        restore.addEventListener('click', async () => {
            if (textarea.value.trim() === String(recommended).trim()) {
                toastr.info('This is already the recommended template.', 'SillyNPC');
                return;
            }
            // It replaces work someone may have spent time on, so it asks.
            const ok = await Popup.show.confirm('Restore recommended template',
                'Your current text will be replaced. Copy it somewhere first if you want to keep it.');
            if (!ok) return;

            textarea.value = recommended;
            setNestedValue(read(), key, stored(String(recommended)));
            write();
            tokens?.refresh();
            onChange?.();
        });
        wrap.append(restore);
    }

    return wrap;
}

export function buildSettingSelect(spec) {
    const { key, label, help, options, onChange } = spec;
    const { read, write } = storeOf(spec);
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    // Says which setting this is, so a control can be found by what it writes rather
    // than by where it happens to be drawn - which is what a rearrangement changes.
    wrap.dataset.setting = key;
    markAdvanced(wrap, spec);

    const row = document.createElement('div');
    row.className = 'sillynpc-setting-row';
    const text = document.createElement('label');
    text.className = 'sillynpc-setting-label';
    text.textContent = label;
    const select = document.createElement('select');
    select.className = 'text_pole';
    for (const opt of options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        select.append(o);
    }
    select.value = getNestedValue(read(), key) ?? '';
    select.addEventListener('change', () => {
        setNestedValue(read(), key, select.value);
        write();
        onChange?.();
    });
    row.append(text, select);
    wrap.append(row);

    appendSettingHelp(wrap, help);
    return wrap;
}

export function buildSettingToggle(options) {
    const { key, label, help, onChange } = options;
    const { read, write } = storeOf(options);
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    // Says which setting this is, so a control can be found by what it writes rather
    // than by where it happens to be drawn - which is what a rearrangement changes.
    wrap.dataset.setting = key;
    markAdvanced(wrap, options);

    const row = document.createElement('label');
    row.className = 'checkbox_label sillynpc-setting-row';
    row.style.cursor = 'pointer';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'sillynpc-setting-label';
    labelSpan.textContent = label;
    labelSpan.style.fontWeight = '500';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!getNestedValue(read(), key);
    input.addEventListener('change', () => {
        setNestedValue(read(), key, input.checked);
        write();
        onChange?.();
    });
    
    row.append(labelSpan, input);
    wrap.append(row);

    appendSettingHelp(wrap, help);

    return wrap;
}

export function buildSettingSlider(options) {
    const { key, label, help, min = 0, max = 100, step = 1, suffix = '', onChange } = options;
    const { read, write, defaults } = storeOf(options);
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    // Says which setting this is, so a control can be found by what it writes rather
    // than by where it happens to be drawn - which is what a rearrangement changes.
    wrap.dataset.setting = key;
    markAdvanced(wrap, options);

    const row = document.createElement('div');
    row.className = 'sillynpc-setting-row';
    const text = document.createElement('label');
    text.className = 'sillynpc-setting-label';
    text.textContent = label;
    
    const sliderContainer = document.createElement('div');
    sliderContainer.className = 'slider-container';
    
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min;
    slider.max = max;
    slider.step = step;
    // A missing value used to fall back to a hardcoded 50, which is out of range for
    // sliders like hudScale (0.5-2.0) and meaningless for the rest. Fall back to the
    // schema default for this exact key, then clamp into the slider's own range so the
    // control can never start outside the bounds it advertises.
    const schemaDefault = getNestedValue(defaults, key);
    const raw = getNestedValue(read(), key) ?? schemaDefault ?? min;
    const numeric = Number(raw);
    slider.value = String(Math.min(max, Math.max(min, Number.isFinite(numeric) ? numeric : min)));
    
    const valueDisp = document.createElement('span');
    valueDisp.className = 'slider-value';
    valueDisp.textContent = `${slider.value}${suffix}`;
    
    // The readout and the stored value follow the drag; the caller is told once, when
    // the drag ends.
    //
    // Reporting from 'input' meant every pixel of movement ran onChange, and onChange
    // rebuilds the whole settings panel - so the slider under the cursor was destroyed
    // and replaced several times a second, taking the drag, the focus and the scroll
    // position with it. Twelve controls in the tracker panel are sliders.
    slider.addEventListener('input', () => {
        valueDisp.textContent = `${slider.value}${suffix}`;
        setNestedValue(read(), key, Number(slider.value));
    });

    slider.addEventListener('change', () => {
        write();
        onChange?.();
    });
    
    sliderContainer.append(slider, valueDisp);
    row.append(text, sliderContainer);
    wrap.append(row);

    appendSettingHelp(wrap, help);
    return wrap;
}

/**
 * A number the user types, with no ceiling.
 *
 * Sliders are the wrong control for a budget. A slider has to advertise a maximum, and any
 * maximum here is a guess about someone else's model: 10k tokens is extravagant on one
 * setup and nothing on another. The cap on Lore Reply Budget was 4000 and on the story
 * excerpt 200000, both arbitrary, and neither could be exceeded however much context the
 * user had bought.
 *
 * So: no max, and no min beyond refusing negatives. The value is repaired on read in
 * normalizeSettings rather than policed on entry, because clearing the box to retype is a
 * normal thing to do and must not be fought.
 *
 * @param {object} options
 * @param {string} options.key Settings key, dot-separated for nested values.
 * @param {string} options.label
 * @param {string} [options.help]
 * @param {string} [options.suffix] Unit shown after the field.
 * @param {() => void} [options.onChange] Called when the field is committed, not per keystroke.
 * @returns {HTMLElement}
 */
export function buildSettingNumber(options) {
    const { key, label, help, suffix = '', onChange, step = 1, min = 0, max, allowEmpty = false, placeholder = '' } = options;
    const { read, write, defaults } = storeOf(options);
    const wrap = document.createElement('div');
    wrap.className = 'sillynpc-setting';
    // Says which setting this is, so a control can be found by what it writes rather
    // than by where it happens to be drawn - which is what a rearrangement changes.
    wrap.dataset.setting = key;
    markAdvanced(wrap, options);

    const row = document.createElement('div');
    row.className = 'sillynpc-setting-row';
    const text = document.createElement('label');
    text.className = 'sillynpc-setting-label';
    text.textContent = label;

    const field = document.createElement('input');
    field.type = 'number';
    field.min = String(min);
    field.step = String(step);
    if (max !== undefined) field.max = String(max);
    if (placeholder) field.placeholder = placeholder;
    field.className = 'text_pole sillynpc-number-input';

    /* Whole numbers unless the step says otherwise - a temperature of 0.2 has to survive,
       and a token budget of 1200.5 must not. allowEmpty is for a setting whose empty value
       means something ("leave it to the model"), where falling back to the default would
       quietly turn that choice into a number. */
    const whole = Number.isInteger(Number(step));
    const parse = (text) => {
        const trimmed = String(text).trim();
        if (trimmed === '') return allowEmpty ? '' : null;
        const numeric = Number(trimmed);
        if (!Number.isFinite(numeric) || numeric < min) return null;
        const capped = max === undefined ? numeric : Math.min(numeric, max);
        return whole ? Math.floor(capped) : capped;
    };

    const schemaDefault = getNestedValue(defaults, key);
    const raw = getNestedValue(read(), key) ?? schemaDefault ?? (allowEmpty ? '' : 0);
    field.value = raw === '' ? '' : String(raw);

    // Store per keystroke so nothing is lost if the panel is rebuilt mid-edit, but tell
    // the caller only on commit - onChange re-renders the panel, which would rip the
    // field out from under the cursor on every digit.
    field.addEventListener('input', () => {
        const parsed = parse(field.value);
        if (parsed !== null) setNestedValue(read(), key, parsed);
    });

    field.addEventListener('change', () => {
        const parsed = parse(field.value);
        const value = parsed !== null ? parsed : (allowEmpty ? '' : Number(schemaDefault) || 0);
        setNestedValue(read(), key, value);
        field.value = value === '' ? '' : String(value);
        write();
        onChange?.();
    });

    if (suffix) {
        const unit = document.createElement('span');
        unit.className = 'sillynpc-number-suffix';
        unit.textContent = suffix;
        const box = document.createElement('div');
        box.className = 'sillynpc-number-container';
        box.append(field, unit);
        row.append(text, box);
    } else {
        row.append(text, field);
    }
    wrap.append(row);

    appendSettingHelp(wrap, help);
    return wrap;
}
