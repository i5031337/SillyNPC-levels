/** Automatic Fill only runs unfinished stages; portrait cost is opt-in. */
export function automaticFillStages(audit, includePortrait = false) {
    return {
        lore: !audit.lore.done,
        profile: !audit.profile.done,
        data: !audit.data.done,
        belongings: !audit.belongings.done && audit.belongings.checked !== false,
        image: !audit.image.done && includePortrait,
    };
}
