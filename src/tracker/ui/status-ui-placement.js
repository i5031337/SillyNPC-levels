/** SillyTavern hides the text container of an image-only message. */
export function isImageOnlyMessage(message) {
    return message?.extra?.inline_image === false
        && Array.isArray(message.extra.media)
        && message.extra.media.length > 0;
}

/** Keep the tracker on the last message whose text can actually be shown. */
export function trackerMessageIndex(chat) {
    if (!Array.isArray(chat)) return -1;
    for (let index = chat.length - 1; index >= 0; index--) {
        if (chat[index] && !isImageOnlyMessage(chat[index])) return index;
    }
    return -1;
}
