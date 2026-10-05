import { collectionAppliesTo } from '../core/collection-targets.js';
import { getAllCharacters } from '../characters/character-repository.js';
import { npcTemplates } from '../core/npc-templates.js';
import { promptText } from '../prompts/prompt-texts.js';
import { getContext } from '../../../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { LOG_PREFIX, debugLog } from '../core/constants.js';
import { loadStateFromMetadata, applyUpdate } from '../tracker/status-logic.js';
import { requestExtraction, coerceToUpdate, describeCollections } from '../tracker/extractor/status-extractor.js';
import { computeStateDiff, partitionChanges } from '../tracker/status-diff.js';
import { setPendingChanges, isItemDecided, getItemRules, DISMISSED_KEY, PLAYER_ACTOR } from '../tracker/status-review.js';

/**
 * A filled-in example of the exact reply wanted, in the ids and fields actually
 * configured.
 *
 * Describing the shape in prose is not enough for a small model. Given a description, a
 * 3B model replied with invented "holds" and "knows" keys, character names as top-level
 * keys, and collections as objects of booleans - none of it usable, and it looped until
 * it ran out of tokens. A worked example in the user's own schema is the difference
 * between a reply that parses and one that does not.
 */
function buildOutputTemplate(trackerSettings) {
    const cols = trackerSettings.collections || [];

    // Angle brackets so a placeholder cannot be mistaken for content: a small model will
    // copy an example verbatim given half a chance. The text stays identical for player
    // and characters, and says nothing a collection id has to be bent to fit - it only
    // has to show the shape, and repeat the one rule that matters.
    const sample = (col) => {
        const item = {};
        for (const field of col.fields || [{ name: 'name' }]) {
            if (field.isPrimary || field.name === 'name') {
                item[field.name] = '<exact name - must still be held at the end>';
            } else if (field.type === 'number') {
                item[field.name] = 1;
            } else {
                item[field.name] = '<optional>';
            }
        }
        return item;
    };

    const template = npcTemplates()[0];
    const forTarget = (target) => {
        const out = {};
        for (const col of cols.filter(c => collectionAppliesTo(c, target, target === 'npc' ? { npcTemplateId: template?.id || '' } : undefined))) out[col.id] = [sample(col)];
        return out;
    };

    return JSON.stringify({
        player: { collections: forTarget('player') },
        characters: [{ name: '<their exact name>', ...(template ? { npcTemplateId: template.id } : {}), collections: forTarget('npc') }],
    }, null, 2);
}

/** What each actor currently holds, so the reply is a correction rather than a guess. */
function describeCurrentCollections(state) {
    const lines = [];
    const describe = (who, collections, scope, actor) => {
        const parts = [];
        for (const [colId, items] of Object.entries(collections || {})) {
            if (!collectionAppliesTo(getSettings().statusTracker.collections?.find(col => col.id === colId), scope, actor)) continue;
            if (Array.isArray(items)) parts.push(`  ${colId}: ${JSON.stringify(items)}`);
        }
        if (parts.length) lines.push(`${who}:`, ...parts);
    };
    describe(state.player?.name || 'Player', state.player?.collections, 'player', state.player);
    for (const character of state.characters || []) describe(character.name, character.collections, 'npc', character);
    return lines.join('\n');
}

/**
 * The items already decided against, which must never be proposed again.
 *
 * Only the "never add this" list is worth sending. The protected list says what must not
 * be taken away, and a scan proposes what people own rather than what they lost, so
 * naming those items here would read as a hint to propose them.
 *
 * @param {object} state Used to name the player, whose entries are stored under a slot.
 */
function describeDismissed(state) {
    const lines = [];
    for (const [slot, collections] of Object.entries(getItemRules(DISMISSED_KEY))) {
        const who = slot === PLAYER_ACTOR ? (state?.player?.name || 'Player') : slot;
        for (const [colId, names] of Object.entries(collections || {})) {
            if (names?.length) lines.push(`  ${who} - ${colId}: ${names.join(', ')}`);
        }
    }
    return lines.join('\n');
}

/**
 * The transcript to read, newest-biased and bounded.
 *
 * Two limits, because they fail differently: a message count keeps a scan cheap on a
 * long chat, and a character budget keeps one enormous message from blowing the context
 * on its own.
 *
 * @returns {{ text: string, used: number, chars: number, truncated: boolean }}
 */
export function collectHistory(trackerSettings) {
    const chunks = collectHistoryChunks(trackerSettings);
    const chat = getContext()?.chat || [];
    const depth = Number(trackerSettings.scanDepth ?? 50);
    const eligible = (depth > 0 ? chat.slice(-depth) : chat)
        .filter(m => m && typeof m.mes === 'string' && m.mes.trim()).length;

    const used = chunks.reduce((n, c) => n + c.used, 0);
    return {
        text: chunks[0]?.text || '',
        used,
        chars: chunks.reduce((n, c) => n + c.chars, 0),
        // Whether anything was left unread, which is what the user needs to know - not
        // how the reading was divided up.
        truncated: used < eligible,
        eligible,
        chunks: chunks.length,
    };
}

/**
 * The history split into passes that each fit the budget.
 *
 * One request could not read a long story: 525 messages of this chat are 426,000
 * characters, so a single pass at any sane budget saw the most recent two hundred and
 * silently ignored the rest - which is why spells established early were never found.
 * Several smaller passes read all of it, and cost a handful of requests instead of one
 * enormous one.
 *
 * Ordered oldest-first overall, but built newest-first so that if a limit does bite it
 * is the distant past that is dropped, not what just happened.
 *
 * @returns {Array<{ text: string, used: number, chars: number }>} Oldest chunk first.
 */
export function collectHistoryChunks(trackerSettings) {
    const chat = getContext()?.chat || [];
    const depth = Number(trackerSettings.scanDepth ?? 50);
    const budget = Math.max(1000, Number(trackerSettings.scanCharBudget ?? 60000));
    // 0 means as many passes as the history needs. A ceiling here silently decided how
    // much of a long chat was read at all: 525 messages came back as the most recent 200.
    const chunkLimit = Number(trackerSettings.scanMaxChunks ?? 0);
    const maxChunks = chunkLimit > 0 ? chunkLimit : Infinity;

    // 0 means the whole chat.
    const wanted = depth > 0 ? chat.slice(-depth) : chat.slice();

    const chunks = [];
    let parts = [];
    let chars = 0;

    const flush = () => {
        if (!parts.length) return;
        parts.reverse();
        chunks.push({ text: parts.join('\n\n'), used: parts.length, chars });
        parts = [];
        chars = 0;
    };

    for (let i = wanted.length - 1; i >= 0; i--) {
        const message = wanted[i];
        if (!message || typeof message.mes !== 'string' || !message.mes.trim()) continue;
        const who = message.is_user ? 'Player' : (message.name || 'Narrator');
        const line = `[${who}] ${message.mes.trim()}`;

        if (line.length > budget) {
            throw new Error(`Message ${chat.length - wanted.length + i + 1} needs ${line.length.toLocaleString()} transcript characters including its speaker label, exceeding the ${budget.toLocaleString()} character budget. No requests were made. Raise "Transcript Per Pass" or edit the message before scanning. Prompt instructions and inventory use additional space beyond this transcript budget.`);
        }
        if (chars + (parts.length ? 2 : 0) + line.length > budget) {
            flush();
            if (chunks.length >= maxChunks) break;
        }
        chars += (parts.length ? 2 : 0) + line.length;
        parts.push(line);
    }
    flush();

    return chunks.reverse();
}

/** What a scan will cost before one is sent, for the confirmation. */
export function estimateScan(trackerSettings = getSettings().statusTracker) {
    let history;
    try { history = collectHistory(trackerSettings); }
    catch (error) { return { error: error.message }; }
    const { used, chars, truncated, eligible, chunks } = history;
    return {
        messages: used, chars, approxTokens: Math.round(chars / 4),
        truncated, eligible, passes: chunks,
    };
}

// Exported for the tests: the prompt texts are checked to send exactly what they did.
export function buildScanPrompt(state, trackerSettings, history) {
    const dismissed = describeDismissed(state);
    return promptText('scanRequest', {
        collections: describeCollections(trackerSettings) || '(none configured)',
        shape: buildOutputTemplate(trackerSettings),
        recorded: describeCurrentCollections(state) || '(nothing recorded yet)',
        dismissed,
        transcript: history.text,
    });
}

/**
 * Reads the history and files everything it finds for review.
 *
 * Nothing is applied here. Even an addition the scan is certain about goes to the panel,
 * because the whole point of a scan is that it is guessing from prose.
 *
 * @returns {Promise<{ ok: boolean, pending?: number, reason?: string, messages?: number }>}
 */
export async function scanHistoryForCollections(onProgress) {
    const trackerSettings = getSettings().statusTracker;
    const context = getContext();
    const chat = context?.chat || [];

    if (!chat.length) return { ok: false, reason: 'This chat is empty.' };
    if (!(trackerSettings.collections || []).length) {
        return { ok: false, reason: 'No collections are configured to fill.' };
    }

    let chunks;
    try { chunks = collectHistoryChunks(trackerSettings); }
    catch (error) { return { ok: false, reason: error.message }; }
    if (!chunks.length) return { ok: false, reason: 'Nothing readable in the history.' };

    const state = structuredClone(loadStateFromMetadata());
    // Offstage cards also own inventories; include them in the prompt and comparison,
    // without joining the scene or saving anything.
    for (const card of getAllCharacters()) {
        if (!card.name || state.characters.some(actor => actor.name.toLowerCase() === card.name.toLowerCase())) continue;
        state.characters.push({ name: card.name, npcTemplateId: card.npcTemplateId,
            collections: structuredClone(card.statusCollections || {}) });
    }
    const rolling = structuredClone(state);
    const merged = { player: { collections: {} }, characters: [] };

    let messages = 0;

    // Each chronological pass corrects the inventory produced by the previous pass.
    for (const [index, chunk] of chunks.entries()) {
        onProgress?.({ chunk: index + 1, of: chunks.length });
        debugLog(`Scanning pass ${index + 1}/${chunks.length}: ${chunk.used} messages, ${chunk.chars} chars`);

        let raw;
        try {
            raw = await requestExtraction(
                buildScanPrompt(rolling, trackerSettings, chunk), null,
                {
                    ...trackerSettings,
                    // A scan lists whole inventories at once; the per-message budget cut
                    // the reply off mid-object.
                    extractionMaxTokens: trackerSettings.scanMaxTokens ?? 3000,
                    // Falls back to the extraction connection when unset.
                    extractionProfileId: trackerSettings.scanProfileId || trackerSettings.extractionProfileId,
                },
                promptText('scanSystem'), { usageKind: 'scan' });
        } catch (err) {
            console.error(LOG_PREFIX, `History scan pass ${index + 1} failed.`, err);
            return failedPass(index, chunks.length, String(err?.message || err));
        }

        const parsed = coerceToUpdate(raw);
        if (!parsed) {
            return failedPass(index, chunks.length, looksTruncated(raw) ? 'a reply ran out of room' : 'a reply was not JSON');
        }

        const update = stripStats(parsed);
        if (!hasUsableCollections(update)) {
            return failedPass(index, chunks.length, describeShapeFailure(parsed, trackerSettings));
        }

        mergeFindings(merged, update, trackerSettings);
        mergeFindings(rolling, update, trackerSettings);
        messages += chunk.used;
    }

    // A scan is about the whole cast, not the current scene, so it may reach characters
    // who are off stage - otherwise everything it learns about them is dropped in silence.
    // allowReplace because a scan is a correction: it reads the whole story and returns
    // what each character should be holding, so a list here really does mean "this is
    // everything". A per-message reply never gets this - there, a list is a mistake.
    // Nothing is written regardless; this is a dry run whose diff goes to the review panel.
    const wouldBe = applyUpdate(merged, { dryRun: true, admitCharacters: true, allowReplace: true });
    // Characters with no card have nowhere to keep what a scan learns. Naming them is
    // the difference between a considered limit and a silent loss.
    const skipped = wouldBe.offstageSkipped || [];
    const changes = computeStateDiff(state, wouldBe, trackerSettings, { fromReplace: true })
        .filter(row => row.kind !== 'stat' && row.kind !== 'stat-max')
        // A row covered by a standing decision never reaches the panel. Both kinds are
        // honoured, not just additions: a scan reading three hundred messages is exactly
        // where an item the story stopped mentioning looks lost, so a protected item
        // needs the guard here more than anywhere.
        .filter(row => !isItemDecided(row));

    const result = {
        ok: true, messages, passes: chunks.length, failures: 0,
        skipped: [...new Set(skipped)],
    };
    if (!changes.length) return { ...result, pending: 0 };

    // Everything a scan finds is a proposal, however confident it looks.
    const { pending } = partitionChanges(changes, { ...trackerSettings, reviewMode: 'all' });
    setPendingChanges(chat.length - 1, pending);

    return { ...result, pending: pending.length };
}

function failedPass(index, passes, reason) {
    return { ok: false, failures: 1, passes,
        reason: `History scan stopped at pass ${index + 1} of ${passes}: ${reason}. No inventory changes were proposed. Retry the complete scan after resolving the failure.` };
}

/** Explicit arrays replace; omitted collections and actors keep their rolling state. */
function mergeFindings(merged, update, trackerSettings = {}) {
    const mergeCollections = (into, from) => {
        for (const [colId, items] of Object.entries(from || {})) {
            if (!Array.isArray(items)) continue;
            const definition = trackerSettings.collections?.find(col => col.id === colId);
            const primary = definition?.fields?.find(field => field.isPrimary)?.name || 'name';
            const byName = new Map();
            for (const item of items) {
                const key = String(item?.[primary] ?? item?.name ?? '').trim().toLowerCase();
                if (key) byName.set(key, { ...byName.get(key), ...item });
            }
            into[colId] = [...byName.values()];
        }
    };
    merged.player ||= { collections: {} };
    merged.player.collections ||= {};
    mergeCollections(merged.player.collections, update.player?.collections);
    for (const character of update.characters || []) {
        if (!character?.name) continue;
        let entry = merged.characters.find(c => c.name.toLowerCase() === String(character.name).toLowerCase());
        if (!entry) {
            entry = { name: character.name, collections: {} };
            merged.characters.push(entry);
        }
        entry.collections ||= {};
        if (character.npcTemplateId) entry.npcTemplateId = character.npcTemplateId;
        mergeCollections(entry.collections, character.collections);
    }
}

/**
 * A reply that was cut off mid-object, or that gave up and repeated itself.
 *
 * A model too small for the task tends to emit the same block over and over until the
 * budget runs out, which reads as a parse failure but has a different remedy.
 */
export function looksTruncated(raw) {
    const text = typeof raw === 'string' ? raw : '';
    if (!text) return false;
    const opens = (text.match(/{/g) || []).length;
    const closes = (text.match(/}/g) || []).length;
    if (opens > closes) return true;
    // The same opening line several times over is a loop, not an answer.
    const first = text.indexOf('"player"') !== -1 ? '"player"' : '"characters"';
    return text.split(first).length > 3;
}

/** Empty containers are a valid unchanged pass; malformed collection values are not. */
function hasUsableCollections(update) {
    const containers = [update.player?.collections, ...(update.characters || []).map(actor => actor.collections)]
        .filter(Boolean);
    return (containers.length > 0 || Array.isArray(update.characters))
        && containers.every(collections => typeof collections === 'object' && !Array.isArray(collections)
            && Object.values(collections).every(Array.isArray));
}

/**
 * Says what was wrong with a reply, in terms the user can act on.
 *
 * "The scan failed" sends someone hunting through their settings. Naming the keys the
 * model actually produced points straight at the model.
 */
function describeShapeFailure(parsed, trackerSettings) {
    const ids = (trackerSettings.collections || []).map(c => c.id);
    const got = Object.keys(parsed || {}).slice(0, 6);
    const detail = got.length ? `It returned ${got.map(k => `"${k}"`).join(', ')}` : 'It returned nothing usable';
    return `${detail}, not the expected ${ids.map(i => `"${i}"`).join(', ')}. `
        + 'This usually means the extraction model is too small for a whole-history pass - '
        + 'try a stronger connection profile for the tracker, or a smaller Messages To Read.';
}

/**
 * Removes anything that is not a collection, at every level.
 *
 * The row filter downstream would catch a stat change too; this stops one being built in
 * the first place. Cheap, and it keeps "a scan does not touch stats" true of the request
 * rather than only of its result.
 */
export function stripStats(parsed) {
    const out = {};
    if (parsed.player?.collections) out.player = { collections: parsed.player.collections };
    if (Array.isArray(parsed.characters)) {
        out.characters = parsed.characters
            .filter(c => c?.name && c.collections)
            .map(c => ({ name: c.name, collections: c.collections,
                ...(typeof c.npcTemplateId === 'string' && c.npcTemplateId
                    ? { npcTemplateId: c.npcTemplateId } : {}),
            }));
    }
    return out;
}
