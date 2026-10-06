import { substituteParams } from '../../../../../../script.js';

/** Copy only Additional Parameters from the selected profile's completion preset. */
export function customProfilePayload(context, profileId) {
    const service = context.ConnectionManagerRequestService;
    const profile = service.getProfile(profileId);
    if (service.validateProfile(profile).source !== 'custom') return {};
    if (!profile.preset) return {};
    const preset = context.getPresetManager('openai')?.getCompletionPresetByName(profile.preset);
    if (!preset) throw new Error(`Completion preset "${profile.preset}" is unavailable.`);

    const payload = {};
    for (const key of ['custom_include_body', 'custom_exclude_body', 'custom_include_headers']) {
        // Empty strings are intentional; absent fields must not inherit the active API's values.
        // The backend merges included YAML after standard fields, then applies exclusions.
        if (typeof preset[key] === 'string') payload[key] = substituteParams(preset[key]);
    }
    return payload;
}
