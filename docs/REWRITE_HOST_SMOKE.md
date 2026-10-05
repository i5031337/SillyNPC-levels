# Host smoke checks

Run these checks in a live SillyTavern session with this extension enabled. Node tests cannot cover SillyTavern popup, event, generation, or rendering behavior. Record the chat, persona, extension revision, and result for each run. Use a disposable chat for actions that generate or modify messages.

## Host verification

- On 2026-09-29, the user reported thoroughly testing the smoke checklist in SillyTavern and confirmed that its behavior works, except for level-up mechanics, which still need enough gameplay to exercise. Results marked **User verified** below record that report; they are not an agent-run browser session.
- The earlier agent check on 2026-09-28 only confirmed that SillyTavern served HTTP 200. It did not verify UI behavior.

## User report on 2026-09-28

The user initially found rare XP awards, overlapping text in Underlines, a tracker box on the home screen, and a tracker box disappearing after image generation. Source fixes followed; the 2026-09-29 smoke report covers those fixes apart from level-up behavior.

## Baseline and regression checklist

| Area | Host action | Expected result | Result |
| --- | --- | --- | --- |
| Dialogue styling | Open a chat containing recognized NPC dialogue, then switch chats and back. | NPC names and dialogue use stable colors and portraits for that chat. | User verified |
| NPC creation and Fill | Create a chat-owned NPC, run Fill, then reopen the card. | Profile and portrait appear, saved values survive reopening, and other chats do not gain the NPC. | User verified |
| Portrait provider | Configure SillyTavern Image Generation, generate a portrait, then choose Use or Discard. | `/imagine` returns an image through the host provider and the chosen action updates or leaves the card accordingly. | User verified |
| NPC edit and lore | Edit a profile field, save, sync lore, then reopen both. | The edited value remains on the card and linked lore entry. | User verified |
| Turn extraction and review | Generate a reply with a clear stat or item change and run the reader. | Proposed changes and reasons are visible; accepting a proposal updates the correct actor once. | User verified |
| XP and level | Generate an accomplishment that awards XP across a level boundary. | The reader's positive XP delta advances the stored remainder and level once; dependent stat growth and collection rewards appear for review. | Level-up mechanics pending |
| Chat and persona scope | Switch to a different chat and persona, then return. | Cast and live tracker state follow the chat; player identity follows the selected persona. | User verified |
| Latest reply changes | Swipe, regenerate, and edit the latest reply. | Review and tracked state correspond to the selected reply; no stale reply changes accumulate. | User verified |

## Player sheet checks

| Case | Host action | Expected result | Result |
| --- | --- | --- | --- |
| Menu access without HUD | Hide the HUD, open SillyNPC's normal menu, select **Player**. | The current persona's full sheet opens with profile, stats, collections, XP/level, portrait, and edit controls. | User verified; level-up display after rollover pending |
| HUD shortcut | Show the HUD and activate its player portrait/action. | The same menu opens directly on **Player**; no second sheet popup appears. | User verified |
| Fill and lore | On **Player**, run Fill for empty fields and portrait, then inspect or sync lore. | Filled data appears in the menu sheet and linked lore; existing fields are not unexpectedly replaced. | User verified |
| Save on tab switch | Edit a profile, stat, and collection value; switch to **Characters** and back. | Each edit saves once and appears once on return. | User verified |
| Save on close | Edit again and close the menu; reopen **Player**. | Values persist once. No duplicate save or redraw effect is visible. | User verified |
| Scope refresh | Keep the menu open while changing chat or persona if SillyTavern permits it; otherwise close, switch, and reopen. | The sheet shows the current chat's player values and the selected persona's identity. | User verified |
| Keyboard and narrow view | Reach the Player tab and its main actions by keyboard; repeat at a narrow viewport. | Controls are operable and the sheet remains readable. | User verified |

For the Player sheet, test with at least two personas and two chats, including one existing chat with saved XP and a portrait. Inspect the browser console for extension errors after each action. If the menu cannot remain open during a chat or persona switch, record that host constraint and use the close/switch/reopen path.

To exercise the remaining level-up case without a long play session, use a disposable chat and manually set the player's XP remainder to one below its displayed cap. Then generate a clearly earned minor accomplishment and inspect the reader report, stored remainder, level, reward proposals, Player sheet, and HUD. The reward-retry case needs a deliberately unusable reward selection response. The
progression/reward flow has changed since the dated user report; verify its current
behavior separately with `tests/ui-level-rewards.py` and `tests/ui-progression-smoke.py`.

## Regression follow-up checks

| Case | Host action | Expected result | Result |
| --- | --- | --- | --- |
| Fill with no lorebook | Open a chat with no chat or default lorebook and Fill an NPC's lore. | A new lorebook is created, bound to the chat, and receives the NPC entry. | User verified |
| Home screen | Leave the chat for SillyTavern's home screen. | No tracker box remains visible. | User verified |
| Image in chat | Generate an image message with tracker placement above, then below the latest prose message. | The tracker remains visible beside the latest prose message in both positions. | User verified |
| Underlines | Select Underlines with Energy and XP visible. | Each name and value is readable once, with no text overlap. | User verified |
| Small XP award | Generate a minor accomplishment, then one that crosses a level boundary. Inspect the raw reader response if XP also appears under `player.stats`. | The reader awards a scaled amount once from `player.deltas.XP`; a stray raw XP value cannot reset the total. | Minor awards user verified; boundary and rollover pending |
| Collection names with commas | Show two tracked items, one with comma-separated adjectives in its name. | Each item has a visible boundary in the tracker summary. | User verified |
| Failed tracker reply | Make the reader return invalid JSON for the latest prose reply, then use **Retry tracker reading** under that reply. | The failed output is visible; retry runs the same message again and applies a valid answer once. | User verified |
| Failed reward selection | Cross an XP threshold and make a One stat or guided reward selection return invalid JSON, then retry the missing rewards. | The XP transition follows its review policy independently; valid choices remain cached. Retry proposes only missing grants and does not award XP again. | Current progression/reward mechanics need a manual gameplay check |
| Failed Fill step | Make Description & Lore or Tracker fields return an unusable response, choose **Retry**, then finish Fill. | Only the failed step runs again, completed parts stay saved, and the card finishes without duplicated items. | User verified |
| Partial NPC lore | Fill a new NPC whose sources support a Role and History but no Ties. | The lore writer may omit Ties; the entry saves, Role and History reach the card, and Ties remains empty. | User verified |
