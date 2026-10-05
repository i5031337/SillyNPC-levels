/** Require a meaningful quoted excerpt from the message that supports a proposal. */
export function quoteInMessage(quote, messageText) {
    const exact = String(quote ?? '').trim();
    return exact.length >= 3 && String(messageText ?? '').toLocaleLowerCase()
        .includes(exact.toLocaleLowerCase());
}
