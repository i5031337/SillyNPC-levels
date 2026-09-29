/** Validate one turn-reader proposal against the active field policy and its source. */
export function quoteInMessage(quote, messageText) {
    const exact = String(quote ?? '').trim();
    return exact.length >= 3 && String(messageText ?? '').toLocaleLowerCase()
        .includes(exact.toLocaleLowerCase());
}

export function replaceableProfileValue(field, value, quote, messageText) {
    if (field?.policy !== 'replaceable' || !quoteInMessage(quote, messageText)) return null;
    return String(value ?? '').trim() || null;
}

export function sourcedMemory(field, proposal, messageId, messageText) {
    if (field?.policy !== 'memory' || messageId == null
        || !quoteInMessage(proposal?.quote, messageText)) return null;
    const text = String(proposal?.text ?? '').trim();
    return text ? { fieldId: field.id, text, sourceMessageId: messageId } : null;
}
