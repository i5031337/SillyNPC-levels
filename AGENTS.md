# SillyNPC XP project notes

- This is a SillyTavern browser extension for LLM roleplay. It detects and styles NPC dialogue, maintains NPC profiles and portraits, tracks player and NPC stats, items, conditions, and goals, and shows character sheets and a HUD. Old story threads remain readable as an archive. A background reader proposes story-derived status changes for review.
- This checkout is the user's GitHub fork, `i5031337/SillyNPC-levels` (`origin`), based on `BrutalKoala/SillyNPC` (`upstream`). Fork features include chat-owned NPCs and automatic player XP, level-ups, and level bonuses. Keep fork behavior and compatibility with existing SillyNPC data in mind. The fork replaces the original extension; they should not run together.
- SillyTavern loads `index.js` and `style.css` from `manifest.json`. There is no build step. `index.js` registers events and imports modules in `src/`; `style.css` imports ordered files in `styles/`. `index.html` and `manage.html` provide UI markup. See `docs/FILE_MAP.md` for module responsibilities.
- Settings live in SillyTavern's `extension_settings.sillynpc` and are normalized by `src/core/settings*.js`. Chat-specific NPC cards and tracker state live in chat metadata. Preserve save, migration, persona, and chat boundaries when changing persistence; existing chats and exports must remain readable.
- Tracker and XP logic is mainly in `src/tracker/`; character ownership is in `src/chat/` and `src/characters/`; views are in `src/ui/`. The background reader reports earned XP only as a positive delta; the extractor converts it to an absolute reading before progression stores the remainder and level. Manual edits and old saved review rows may still use absolute values.
- Run focused tests with `node --experimental-default-type=module --test tests/*.mjs`. For UI or SillyTavern event changes, also verify behavior in a running SillyTavern instance, since the Node tests do not cover the full host UI.

# Coding practices

- No source file should exceed 20kB, for agentic efficiency. Keep code clear and concise. When appropriate, recommend a refactor strategy. 
- This project is a prototype. Never make something more complicated for the sake of legacy compatibility.
