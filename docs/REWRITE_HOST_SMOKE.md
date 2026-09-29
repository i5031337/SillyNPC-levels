# Rewrite host smoke checks

Run these checks in a live SillyTavern session with this extension enabled. Node tests cannot cover SillyTavern popup, event, generation, or rendering behavior. Record the chat, persona, extension revision, and result for each run. Use a disposable chat for actions that generate or modify messages.

## Host availability on 2026-09-28

- `http://127.0.0.1:8000/` returned HTTP 200 from SillyTavern.
- No authenticated browser session or browser automation interface was available to this agent. The HTTP response confirms the host is serving pages; it does not verify that the extension loaded or that any UI action works.
- Phase 1 UI work was in progress during this check, so the cases below are acceptance checks rather than claimed passes.

## User report on 2026-09-28

The user reports that the existing checklist appears to work, except XP and leveling are hard to exercise because the reader awards XP too rarely. They also found overlapping text in the Underlines HUD, a tracker box on the SillyTavern home screen, and a tracker box disappearing after an image is generated in chat. Source fixes are in progress; the affected cases need another host run.

## Baseline and regression checklist

| Area | Host action | Expected result | Result |
| --- | --- | --- | --- |
| Dialogue styling | Open a chat containing recognized NPC dialogue, then switch chats and back. | NPC names and dialogue use stable colors and portraits for that chat. | Pending interactive run |
| NPC creation and Fill | Create a chat-owned NPC, run Fill, then reopen the card. | Profile and portrait appear, saved values survive reopening, and other chats do not gain the NPC. | Pending interactive run |
| Portrait provider | Configure SillyTavern Image Generation, generate a portrait, then choose Use or Discard. | `/imagine` returns an image through the host provider and the chosen action updates or leaves the card accordingly. | Pending interactive run |
| NPC edit and lore | Edit a profile field, save, sync lore, then reopen both. | The edited value remains on the card and linked lore entry. | Pending interactive run |
| Turn extraction and review | Generate a reply with a clear stat or item change and run the reader. | Proposed changes and reasons are visible; accepting a proposal updates the correct actor once. | Pending interactive run |
| XP and level | Generate an accomplishment that awards XP across a level boundary. | Absolute XP from extraction becomes the stored remainder and next level; level bonus is retained. | Pending interactive run |
| Chat and persona scope | Switch to a different chat and persona, then return. | Cast and live tracker state follow the chat; player identity follows the selected persona. | Pending interactive run |
| Latest reply changes | Swipe, regenerate, and edit the latest reply. | Review and tracked state correspond to the selected reply; no stale reply changes accumulate. | Pending interactive run |

## Phase 1 player sheet checks

| Case | Host action | Expected result | Result |
| --- | --- | --- | --- |
| Menu access without HUD | Hide the HUD, open SillyNPC's normal menu, select **Player**. | The current persona's full sheet opens with profile, stats, collections, XP/level, portrait, and edit controls. | Pending interactive run |
| HUD shortcut | Show the HUD and activate its player portrait/action. | The same menu opens directly on **Player**; no second sheet popup appears. | Pending interactive run |
| Fill and lore | On **Player**, run Fill for empty fields and portrait, then inspect or sync lore. | Filled data appears in the menu sheet and linked lore; existing fields are not unexpectedly replaced. | Pending interactive run |
| Save on tab switch | Edit a profile, stat, and collection value; switch to **Characters** and back. | Each edit saves once and appears once on return. | Pending interactive run |
| Save on close | Edit again and close the menu; reopen **Player**. | Values persist once. No duplicate save or redraw effect is visible. | Pending interactive run |
| Scope refresh | Keep the menu open while changing chat or persona if SillyTavern permits it; otherwise close, switch, and reopen. | The sheet shows the current chat's player values and the selected persona's identity. | Pending interactive run |
| Keyboard and narrow view | Reach the Player tab and its main actions by keyboard; repeat at a narrow viewport. | Controls are operable and the sheet remains readable. | Pending interactive run |

For Phase 1, test with at least two personas and two chats, including one existing chat with saved XP and a portrait. Inspect the browser console for extension errors after each action. If the menu cannot remain open during a chat or persona switch, record that host constraint and use the close/switch/reopen path.

## Phase 7 follow-up checks

| Case | Host action | Expected result | Result |
| --- | --- | --- | --- |
| Fill with no lorebook | Open a chat with no chat or default lorebook and Fill an NPC's lore. | A new lorebook is created, bound to the chat, and receives the NPC entry. | Source fix; host retest pending |
| Home screen | Leave the chat for SillyTavern's home screen. | No tracker box remains visible. | Source fix; host retest pending |
| Image in chat | Generate an image message with tracker placement above, then below the latest prose message. | The tracker remains visible beside the latest prose message in both positions. | Source fix; host retest pending |
| Underlines | Select Underlines with Energy and XP visible. | Each name and value is readable once, with no text overlap. | Source fix; host retest pending |
| Small XP award | Generate a minor accomplishment, then one that crosses a level boundary. | The reader awards a scaled amount once, then stores the correct level and XP remainder. | Prompt updated; host retest pending |
