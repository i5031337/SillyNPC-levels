import { NPC_LORE_FIELDS } from '../core/constants-profile.js';

/** Shipped text for editable prompts. SillyTavern stores customized versions as strings. */
const loreFieldInstructions = NPC_LORE_FIELDS.map(field => `- ${field.label}: ${field.hint}`).join('\n');
const loreReplyFields = NPC_LORE_FIELDS.map(field => `${field.label}: ...`).join('\n');
export const DEFAULT_LORE_PROMPT = `Write a Lorebook entry for "{{name}}".

Established facts - treat these as true and do not contradict them:
{{facts}}

Setting reference:
{{world}}

Existing entry:
{{lore}}

Recent story:
{{context}}

Write one Content entry with these named fields in this order. Keep each one short.

${loreFieldInstructions}

Rules:
- Keep established named fields unchanged. Fill only blanks supported by the sources.
- Revise established field values only when explicitly asked to regenerate them. Fill changes blanks only.
- Weigh the whole history, not the most recent scene. A character who was frightened, angry or hurt in the last few messages is not permanently that way.
- Write what is generally true of them, not what was true five minutes ago.
- Do NOT invent affiliations, factions, agendas, hidden links, secret knowledge or people they answer to.
- Do not repeat details across fields.
- Do NOT list their spells, items, skills or numbers.
- Invent nothing. If neither the facts nor the story supports a detail, leave it out.
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

Reply in exactly this format:
Tags: comma separated keywords
Content:
${loreReplyFields}`;

export const DEFAULT_IMAGE_REFERENCE_PREAMBLE = `[Reference Image Directive]
Use the attached image(s) strictly as a visual anchor for character identity. Maintain precise consistency with their facial anatomy, eye shape and color, hair color and style, skin tone, and permanent bodily features.

Apply the attire, pose, and lighting specified in the main description above. Do not copy any background elements, text, or visual artifacts from the reference image.

Generate the image now. Do not output text, descriptions, explanations, or commentary: return only the generated image.`;
