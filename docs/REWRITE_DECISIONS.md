# Rewrite decisions

Decisions made during implementation on 2026-09-28. Read alongside `PRODUCT_SPEC_DRAFT.md` and `REWRITE_PLAN.md`.

- **System assignment:** A chat may choose its System before its first player message, then keeps it. The rewrite does not need a mid-chat schema mapping flow.
- **Reader review:** Apply valid changes automatically by default. Keep the review and correction path available. Field policies still gate application.
- **Player state:** Stats, inventory, goals, and memories belong to the chat and selected persona. Persona identity, portrait, and profile remain on the persona record.
- **Old Threads:** Preserve them as an archived, readable record when Goals replaces the live Threads feature.
- **Memories:** Make the per-character retention limit configurable. Start with 50 entries as the default; retain older entries as an archive rather than silently dropping them.
- **Prompts:** Remove raw prompt editing once schema-generated prompts cover the reader and Fill workflows. Keep diagnostics for failed extraction.
- **Portrait generation:** Use SillyTavern's base image generation extension and its backends. Remove this project's separate backend implementation and associated controls after replacing its callers.
- **Code size:** Prefer deleting superseded paths and keeping the replacement straightforward. Preserve old stored data at load/import boundaries without retaining redundant runtime flows.
- **XP reader format:** The background turn reader awards XP only as a positive `player.deltas.XP` amount. It discards a raw XP value in that same reply, then converts the delta to an absolute reading at the progression boundary. Manual edits and older saved review rows can still carry absolute values.
