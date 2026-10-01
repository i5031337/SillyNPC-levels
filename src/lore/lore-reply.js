/** Read the lore writer's small YAML envelope and older Tags/Content replies. */
export function loreReplyWasTruncated(reply) {
    const reason = reply?.choices?.[0]?.finish_reason
        ?? reply?.choices?.[0]?.native_finish_reason
        ?? reply?.results?.[0]?.finish_reason
        ?? reply?.finish_reason;
    return ['length', 'max_tokens', 'max_output_tokens', 'token_limit'].includes(reason);
}

export function parseLoreReply(reply, fields = []) {
    const raw = String(reply ?? '').trim();
    const text = raw.replace(/^```(?:ya?ml|text)?\s*\n/i, '').replace(/\n```\s*$/, '').trim();
    const tagsMatch = text.match(/^Tags:[ \t]*([^\r\n]*)/im);
    const contentMatch = text.match(/^Content:[ \t]*([^\r\n]*)/im);
    if (!tagsMatch || !contentMatch || contentMatch.index <= tagsMatch.index) {
        return { tags: '', content: raw, followedSections: false };
    }

    const tagLines = text.slice(tagsMatch.index + tagsMatch[0].length, contentMatch.index)
        .trim().split(/\r?\n/).filter(Boolean);
    const inlineTags = tagsMatch[1].trim();
    const tags = inlineTags.startsWith('[') && inlineTags.endsWith(']')
        ? inlineTags.slice(1, -1).split(',').map(tag => tag.trim().replace(/^['"]|['"]$/g, '')).join(', ')
        : inlineTags || tagLines.map(line => line.replace(/^\s*-\s*/, '').trim()).join(', ');
    let content = text.slice(contentMatch.index + contentMatch[0].length).replace(/^\r?\n/, '');
    const firstIndent = content.match(/^[ \t]+(?=\S)/)?.[0] || '';
    if (firstIndent) content = content.replace(new RegExp(`^${firstIndent}`, 'gm'), '');
    content = content.trim();
    const inline = contentMatch[1].trim();
    if (inline && inline !== '|' && inline !== '>') content = `${inline}${content ? `\n${content}` : ''}`;
    if (fields.length) {
        const values = new Map();
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
            const match = line.match(/^([^:]+):[ \t]*(.*)$/);
            const key = match?.[1].trim().toLowerCase();
            const field = fields.find(item => item.label.toLowerCase() === key || item.id.toLowerCase() === key);
            if (!field || values.has(field.id)) break;
            values.set(field.id, match[2].trim().replace(/^(['"])(.*)\1$/, '$2'));
        }
        if (values.size === lines.length) {
            content = fields.filter(field => values.has(field.id))
                .map(field => `${field.label}: ${values.get(field.id)}`).join('\n');
        }
    }
    return { tags, content, followedSections: true };
}
