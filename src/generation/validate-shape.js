import { LIMITS } from './contracts.js';
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const unsafe = /<\s*\/?\s*[a-z!][^<>]*>|<\s*(?:script|iframe|img|svg)\b|javascript\s*:/i;
/** Small JSON-schema subset, matching the provider-compatible contracts used here. */
export function validateShape(value, schema, path = '$', errors = []) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = type => type === 'object' ? isObject(value) : type === 'array' ? Array.isArray(value)
        : type === 'integer' ? Number.isSafeInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === type;
    if (schema.type && !types.some(matches)) { errors.push(`${path}: expected ${types.join(' or ')}`); return errors; }
    if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: unsupported value ${JSON.stringify(value)}; expected one of ${schema.enum.map(item => JSON.stringify(item)).join(', ')}`);
    if (typeof value === 'string') {
        if (value.length > (schema.maxLength ?? LIMITS.text)) errors.push(`${path}: text too long`);
        if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: invalid identifier`);
        if (unsafe.test(value)) errors.push(`${path}: use ordinary text without markup or executable content`);
    }
    if (typeof value === 'number') {
        if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be at least ${schema.minimum}`);
        if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be at most ${schema.maximum}`);
    }
    if (Array.isArray(value)) {
        if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: expected at least ${schema.minItems} entries, received ${value.length}`);
        if (value.length > (schema.maxItems ?? LIMITS.fields)) errors.push(`${path}: too many entries`);
        value.slice(0, schema.maxItems ?? LIMITS.fields).forEach((item, index) => validateShape(item, schema.items, `${path}[${index}]`, errors));
    } else if (isObject(value)) {
        for (const key of schema.required || []) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
        for (const [key, item] of Object.entries(value)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) { errors.push(`${path}.${key}: forbidden key`); continue; }
            const child = schema.properties?.[key];
            if (child) validateShape(item, child, `${path}.${key}`, errors);
            else if (schema.additionalProperties === false) errors.push(`${path}.${key}: unsupported field`);
            else if (isObject(schema.additionalProperties)) validateShape(item, schema.additionalProperties, `${path}.${key}`, errors);
        }
    }
    return errors;
}
/** Reject truncation; extraction may remove prose/fences but never invent missing JSON. */
export function parseResponse(raw) {
    if (typeof raw !== 'string') {
        if (!isObject(raw)) throw new Error('Expected a JSON object');
        if (JSON.stringify(raw).length > LIMITS.responseChars) throw new Error('Response too large');
        return structuredClone(raw);
    }
    if (raw.length > LIMITS.responseChars) throw new Error('Response too large');
    const start = raw.indexOf('{');
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; start >= 0 && i < raw.length; i++) {
        const char = raw[i];
        if (escaped) escaped = false;
        else if (quoted && char === '\\') escaped = true;
        else if (char === '"') quoted = !quoted;
        else if (!quoted) {
            if (char === '{') depth++;
            if (char === '}' && --depth === 0) return JSON.parse(raw.slice(start, i + 1));
        }
    }
    throw new Error('Malformed or truncated JSON response');
}
