/** Automatic Fill only runs unfinished stages; portraits can be disabled in Generation. */
export function automaticFillStages(audit, includePortrait = true) {
    return {
        lore: !audit.lore.done,
        image: !audit.image.done && includePortrait,
    };
}
