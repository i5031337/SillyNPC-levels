/** Automatic Fill only runs unfinished stages; portraits can be disabled in Generation. */
export function automaticFillStages(audit, includePortrait = true) {
    return {
        lore: !audit.lore.done,
        data: !audit.data.done,
        belongings: !audit.belongings.done && audit.belongings.checked !== false,
        image: !audit.image.done && includePortrait,
    };
}
