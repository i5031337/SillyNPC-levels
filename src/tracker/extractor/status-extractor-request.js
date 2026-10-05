import { extractMessageFromData } from '../../../../../../../script.js';
import { getContext } from '../../../../../../st-context.js';
import { applyMacros } from '../../prompts/macros.js';
import { LOG_PREFIX, debugLog, SYSTEM_PROMPT } from '../../core/constants.js';
import { describeConnection, extractJSON, safeJsonParse } from '../../core/utils.js';
import { recordUsage } from '../../core/usage.js';

/** What a reply cost, whether it arrived as text or as already-parsed data. */
function describeAnswer(answer) {
    if (typeof answer === 'string') return answer;
    try { return JSON.stringify(answer ?? ''); } catch { return ''; }
}
/** Optional reader temperature, constrained to the supported 0–2 range. */
export function readerTemperature(trackerSettings) {
    const typed = String(trackerSettings?.extractionTemperature ?? '').trim();
    if (typed === '') return null;
    const numeric = Number(typed);
    return Number.isFinite(numeric) && numeric >= 0 && numeric <= 2 ? numeric : null;
}

/**
 * Runs the request, preferring a dedicated Connection Profile.
 *
 * @returns {Promise<string|object>} Model output. A backend given a json_schema may
 * return already-parsed data rather than text, so callers must handle both.
 */

export async function requestExtraction(userPrompt, schema, trackerSettings, systemPrompt = null, { usageKind = 'extraction' } = {}) {
    // History scans can supply a specialized prompt. Ordinary turns use the built-in.
    systemPrompt = applyMacros(systemPrompt || SYSTEM_PROMPT);
    const context = getContext();
    const profileId = trackerSettings.extractionProfileId;
    const maxTokens = Number(trackerSettings.extractionMaxTokens) || 1200;
    const temperature = readerTemperature(trackerSettings);

    debugLog(`Extraction -> ${describeConnection(profileId)}, reply budget ${maxTokens}`);

    if (profileId) {
        // Connection Manager can be disabled, and the profile may have been deleted;
        // either throws, so fall through to the main API rather than failing the sync.
        try {
            const service = context.ConnectionManagerRequestService;
            const result = await service.sendRequest(
                profileId,
                [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
                maxTokens,
                { extractData: true, includePreset: false },
                {
                    // Structured output is opt-in: some backends return an empty object
                    // rather than reject a schema they dislike, which loses the update
                    // silently. The system prompt pins the shape without it.
                    ...((schema && trackerSettings.extractionUseSchema) ? { json_schema: schema } : {}),
                    // Sent only when you set one. Nothing of the story preset comes with the
                    // request (includePreset is off), so with no temperature here the model's
                    // own default decides - usually 1.0, which is loose for reading facts.
                    ...(temperature === null ? {} : { temperature }),
                },
            );
            const answer = typeof result === 'string' ? result : (result?.content ?? result ?? '');
            recordUsage(usageKind, { prompt: systemPrompt + userPrompt, reply: describeAnswer(answer) });
            return answer;
        } catch (err) {
            console.warn(LOG_PREFIX, 'Extraction profile unavailable, falling back to the main API:', err);
        }
    }

    const raw = await context.generateRawData({
        prompt: userPrompt,
        systemPrompt,
        responseLength: maxTokens,
        jsonSchema: trackerSettings.extractionUseSchema ? schema : null,
    });
    // Without a schema, generateRawData returns the provider response. Its text may
    // be in choices, results, or content blocks rather than a top-level content field.
    // With a schema, SillyTavern has already extracted the JSON response for us.
    const answer = schema && trackerSettings.extractionUseSchema
        ? raw
        : extractMessageFromData(raw);
    recordUsage(usageKind, { prompt: systemPrompt + userPrompt, reply: describeAnswer(answer) });
    return answer;
}

/**
 * Turns whatever the backend returned into an update object.
 *
 * A structured-output backend returns parsed data; everything else returns text that
 * may be wrapped in prose or a code fence, which extractJSON/safeJsonParse handle.
 *
 * @param {string|object} raw
 * @returns {object|null}
 */
export function coerceToUpdate(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return Array.isArray(raw) ? null : raw;
    return safeJsonParse(extractJSON(String(raw)));
}
