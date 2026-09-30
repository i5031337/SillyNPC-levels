export const DEFAULT_LORE_PROMPT = `Write a Lorebook entry for "{{name}}".

Use established facts and relevant history. Describe what is generally true of the character. Do not invent profile details; omit unsupported fields. Keep each field brief and avoid repeating details.

Established facts - treat these as true and do not contradict them:
{{facts}}

Setting reference:
{{world}}

Existing entry:
{{lore}}

Recent story:
{{context}}

Available Content fields, in output order:
{{profileFields}}

Format:
- Include each established named field unchanged. Omit fields with no supported value.
- Put each included field on its own labelled line in the order above, using the exact labels. Use third person.
- Tags are lorebook activation keys: use only the character's names and nicknames used in the story, never ordinary words or titles.

Reply with only these two sections:
Tags: comma-separated names
Content:`;
