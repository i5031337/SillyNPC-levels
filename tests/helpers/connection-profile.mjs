import { readFile } from 'node:fs/promises';

const source = (await readFile(new URL('../../src/api/api-connection-profile.js', import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '').replace('export function', 'function');
export const customProfilePayload = new Function('substituteParams', `${source}\nreturn customProfilePayload;`)(
    value => value.replaceAll('{{model}}', 'fixture-model'),
);

export function profileContext(context) {
    context.getPresetManager ??= api => {
        if (api !== 'openai') throw new Error('Expected chat-completion presets');
        return { getCompletionPresetByName: name => context.presets?.[name] };
    };
    if (context.ConnectionManagerRequestService) {
        context.ConnectionManagerRequestService = {
            getProfile: () => ({ api: 'openai' }),
            validateProfile: profile => ({ source: profile.api }),
            ...context.ConnectionManagerRequestService,
        };
    }
    return context;
}
