export const DEFAULT_LORE_PROMPT = `Write a Lorebook entry for "{{name}}".

Use established facts and relevant history. Describe what is generally true of the character. Do not invent profile details; omit unsupported fields. Keep each field brief and avoid repeating details.

Keep established named fields unless the story clearly changes them. Omit fields with no supported value. Use third person. Tags are lorebook activation keys: use only the character's names and nicknames used in the story, never ordinary words or titles.

Established facts - treat these as true and do not contradict them:
{{facts}}

Setting reference:
{{world}}

Existing entry:
{{lore}}

Recent story:
{{context}}

Reply with only this YAML, without a Markdown code fence. Replace each angle-bracket instruction with a brief value. Omit unsupported field lines; keep the remaining lines in this order. Indent content lines by two spaces. Add established names or nicknames to tags, separated by commas:
tags: {{name}}
content: |
{{profileTemplate}}`;
