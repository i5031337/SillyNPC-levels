/** Shipped text for editable prompts. SillyTavern stores customized versions as strings. */
export const DEFAULT_LORE_PROMPT = `Write a Lorebook entry for "{{name}}".

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

Rules:
- Include each established named field unchanged. Add other fields only when the sources support a value. Omit fields with no supported value.
- Keep each included field short, on its own labelled line, in the order above. Use the exact labels. Write no unlabelled prose.
- Weigh the whole history, not the most recent scene. A character who was frightened, angry or hurt in the last few messages is not permanently that way.
- Write what is generally true of them, not what was true five minutes ago.
- Do NOT invent affiliations, factions, agendas, hidden links, secret knowledge or people they answer to.
- Do not repeat details across fields.
- Do NOT list their spells, items, skills or numbers.
- Invent nothing.
- An entry that is short because little has happened is correct.
- Third person. No preamble and no closing remark.

TAGS - read this carefully, it matters more than the rest:
- Tags are not topic labels. They are lorebook ACTIVATION KEYS for SillyTavern. Any tag that is an ordinary word will load this entry into unrelated scenes.
- Use ONLY: the character's given name, surname, full name, and nicknames actually used for them in the story.
- NEVER use job titles.
- NEVER use roles or types.
- NEVER use place names.
- NEVER use adjectives or states.
- Do not wrap tags in square brackets.

Reply with Tags and Content exactly as follows. Content contains only the included field lines:
Tags: comma separated keywords
Content:`;
