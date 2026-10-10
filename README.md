<p align="center">
  <img src="img/SillyNPCLogo.jpg" alt="SillyNPC" width="420">
</p>

# SillyNPC XP

For the source layout and each file's responsibility, see the [file map](docs/FILE_MAP.md).

This fork adds automatic player XP progression and chat-owned NPCs to SillyNPC. Install it **instead of**
the original extension; both use the same settings and events and must not run together.

With the Status Tracker enabled, the reader can award XP for concrete accomplishments
in the latest story message, including useful item acquisitions, resolved challenges,
and successful NPC interactions. It reports the earned amount. For example,
an award of 20 when XP is `90/100` is reported as a `+20` delta.

The extension then automatically advances Level to 2 and stores `10/100` XP. The
current XP maximum stays the threshold for subsequent levels, and large awards can
cross multiple levels. On a level-up in separate extraction mode, the reader makes
an additional request to choose a story-appropriate bonus. It may increase an
eligible numeric player stat by 1–5, or write a narrative perk. The bonus follows
the configured review policy. The latest accepted bonus appears in the
player's `Level Bonus` field. In inline mode, the narrator is asked
to supply that field with its status update. If no bonus can be read from the LLM,
the level-up still occurs; the bonus can be entered on the Player tab.

XP awards are model judgments and can be corrected on the Player tab. Each award
should correspond to an accomplishment in the latest message; events already counted
should not be awarded again. The tracker review settings still govern proposed
changes, including a review mode that holds all changes for approval.
The in-chat tracker offers one undo step for the latest state change. Swiping,
regenerating, or editing the latest assistant reply rebases that turn's tracker
changes from its pre-reply state. Older messages no longer show reconstructed
tracker boxes; the current box appears under the latest message.

[![SillyTavern Compatible](https://img.shields.io/badge/SillyTavern-Extension-crimson?style=for-the-badge&logo=electron&logoColor=white)](https://github.com/SillyTavern/SillyTavern)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=for-the-badge)](https://github.com/BrutalKoala/SillyNPC/pulls)

---

## Overview

SillyNPC operates across two core modules:

1. **Character Stylist** — Detects speaker names in chat messages and automatically injects character portraits, customizable text/border accent colors, and speech dividers.
2. **Status Tracker & HUD** — Maintains an RPG-style state (attributes, resource pools, inventory, conditions, and anything else you define) for the player and NPCs via an asynchronous background reading pass. Renders data inside chat messages, on full character sheets, or via a floating on-screen HUD.

---

## Key Features

### Dialogue & Speaker Stylist
* **Automatic Speaker Detection:** Parses speaker prefixes (e.g., `**Character**: Dialogue`) directly from LLM output.
* **Per-Character Visuals:** Configurable avatars, custom accent colors, and speech block borders per character card.
* **Auto-Coloring for Minor NPCs:** Generates consistent, deterministic color shades for unrecognized or minor speakers without dedicated cards.
* **Faces for Strangers:** Speakers without a card draw from a pool of fallback portraits, tagged so a guard draws from the guards. A stranger keeps the same face for as long as they keep appearing.

### RPG Status Tracking & Character Sheets
* **Comprehensive State Model:** Tracks attributes, resource pools (HP/Energy by default), conditions, inventory, and any collection you define. In **Systems → Stats**, **Profile fields**, and **Collections**, define each asset once and assign any combination of the player, all NPCs, and named NPC templates (for example, clothing for the player and humans, or moves for Pokémon).
* **Dedicated Extraction Pass:** Processes state updates in a background pass to keep tracker logic from polluting the primary prompt context.
* **Review Controls:** Valid reader changes apply automatically by default. You can switch to review modes that hold risky changes or all changes for approval.
* **Interactive Sheets:** Edit the selected persona's profile, stats, items, and memories on the **Player** tab. The HUD opens the same view. NPC sheets use the active System's profile fields.

### Memories
* **Character Memories:** Add, edit, and remove memories on character sheets without configuring a profile field. Older entries move to an archive; only active entries are included in the NPC's linked lorebook.
* **Occasional NPC Memory Reader:** Under **Systems → Builder → Profile fields**, enable memory capture and optionally describe memorable events for your genre. A separate request uses the reader connection every eight assistant replies by default. Suggestions use the existing collection review controls and always wait for approval, independently of tracker review mode.
* **Read Memories Now:** The brain icon beside the send controls reads the oldest unread segment on demand. Long chats may need several passes; the button reports remaining replies. This is currently separate from the History reader. Progress and pending suggestions survive reloads. Changed supporting replies invalidate automatic memories; manual entries and corrections are preserved.

### Floating HUD
* **Four Meter Styles:** Bars, segmented bars, rings around the portrait, or text only.
* **Real-Time Updates:** Syncs automatically as the background tracker extracts new values from the narrative.

### Character & World Management
* **Roster Categories:** Organize characters into distinct worlds, factions, or scenes — and limit a chat to only the categories it needs.
* **Chat-Owned NPCs:** New characters created in a chat belong to that chat, survive persona changes, and do not appear in unrelated chats. Legacy world cards remain available as reusable sources; **Use in this chat** copies one, while **New profile in this chat** starts a blank NPC with the same name. New chat NPCs only link existing lorebook entries when you explicitly choose Sync.
* **Portable Character Files:** Export identity, profile, linked lore text, and NPC stats marked Carry between adventures. Other stats, conditions, and inventory start from the destination System's defaults on import. Portrait image files are omitted from character exports.
* **Export World Characters:** Under **Systems → Manager**, export reusable world cards and NPCs from every chat assigned to a Saved System, including chats that are closed and Systems that are not active. The existing full System export is still available separately.
* **Integrated Generation:** Generates lorebook entries and uses SillyTavern's Image Generation extension for portraits, with its configured provider.

### Theming & Analytics
* **Built-in Themes:** Seamless Native, Terminal, Cyberpunk, Monochrome, Modern Dark, Fantasy HUD, Tabletop Parchment, Analog Horror, and Rosewater.
* **Token Tracking:** Monitors token consumption and average usage across tracker extractions, lore generation, and collection scans.
* **Recommended for Better Visuals:** the [Moonlit Echoes](https://github.com/RivelleDays/SillyTavern-MoonlitEchoesTheme) theme.

---

## Screenshots

| In-Chat Formatting | Character Profile |
| :---: | :---: |
| ![Chat Formatting](img/chatexmp.png) | ![Character Profile](img/charcterexmp.png) |

| Radial Floating HUD | Linear Floating HUD |
| :---: | :---: |
| ![Radial HUD](img/floathudcircle.png) | ![Horizontal HUD](img/floathudbar.png) |

| Character Roster / Worlds | Appearance & Themes |
| :---: | :---: |
| ![Roster](img/charactersexmp.png) | ![Themes](img/styleexmp.png) |

| Player Sheet | Token Costs |
| :---: | :---: |
| ![Player Sheet](img/playerexmp.png) | ![Stats](img/stats.png) |

---

## Installation

### Method 1: SillyTavern Extension Installer
1. Open SillyTavern and click **Extensions** (stacked blocks icon) -> **Install Extension**.
2. Paste this fork's repository URL: `https://github.com/i5031337/SillyNPC-levels`.
3. Click **Save / Install** and refresh the page.

### Method 2: Manual Clone
Clone the repository directly into your SillyTavern installation directory:

```bash
cd SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/i5031337/SillyNPC-levels.git SillyNPC
```
Reload SillyTavern.

---

## Quick Start

1. **Dialogue Formatting:**
   * **Ask The Model To Format Dialogue** is on out of the box — it asks for the `**Name**:` speaker line that everything else reads.
   * If your chat is not being decorated, check it is still enabled under **Extensions -> SillyNPC -> Manage SillyNPC -> Writing Rules**. A persona or preset asking for a different layout is the usual cause.
2. **Assigning Avatars:**
   * Click an unknown speaker's placeholder portrait to create its chat-owned card and start Fill immediately. Fill writes missing lore and profile details, then offers a portrait; completed stages remain in place if a later stage fails. The tracker maintains stats and collections. Open the card and press **Fill** to retry.
   * Use the adjacent **Link as alias** button if the speaker is another name for an existing NPC. Clicking a reusable card's portrait offers a new profile for this chat or its editor; clicking a chat NPC's portrait opens its editor.
   * Automatic Fill draws a portrait by default when the NPC has none. Change **Draw Portrait Automatically** under **Generation → Image Generation**, or add a portrait in the editor. Your selected image provider may charge separately.
   * Generated portraits use SillyTavern's Image Generation extension and its configured provider. Set **Generation → Image Generation → Image Prompt Prefix** for composition instructions (default: `Solo, profile picture`); clear it to omit them. The prefix applies to automatic portraits and is included in the editable manual prompt.
3. **Enabling Tracker & HUD:**
   * The tracker is **on by default** for new settings. If it is not reading messages, check **Enable Status Tracker** under the **Tracker** tab; previously saved settings may have it off.
   * Under **Tracker → Customize display**, toggle **Show World Stats**, **Show Player Stats**, and **Show NPC Stats** independently. Hiding all three removes the tracker bar while background tracking continues. Turn off **Show Raw Tracker Output** to hide the reader’s progress and output dropdown. The HUD has its own visibility setting.
   * To run the reader on demand, select **Tracker → How Stats Are Read → Method → Manual — run from the send bar**. Click the book icon (**Read latest reply**) beside the send controls after an assistant reply. It reads that reply with the configured lead-up, using the usual reader connection and review settings. Reading the same reply again replaces its previous reading without awarding XP twice.
   * Enable **Tracker → How Stats Are Read → Generate Profiles For New NPCs** to create a chat-owned card and generate its configured profile fields when the separate reader identifies an NPC without a card. This is off by default and uses the lore generation connection and context settings, costing one extra request per new NPC. Existing cards and manual edits are preserved; unsupported details may stay blank. Failed attempts can be retried with **Fill** on the character sheet. The shared **Draw Portrait Automatically** setting also requests a missing portrait after these profiles are saved.
   * The HUD appears once the tracker is running; choose Plate, Underlines, Pip Rows, or Split Ring under the **HUD** tab.

### NPC stats and character transfers

In **Systems → Builder → Stats**, **Show name** controls whether the tracker prefixes a stat’s value with its name. **Locked** prevents story reader changes after initialization. The reader may seed blank locked NPC fields once; direct edits and configured level-up increases remain available. A blank NPC Level may be initialized once, even when Locked; afterward progression manages it automatically. Keep XP unlocked so the reader can report earned XP.

In the shared Stats editor, **NPC carryover** independently controls whether a stat travels with the character. Unchecked stats start from the destination System's defaults on import or when instantiated from a reusable world card. Existing Advancement fields migrate to Locked and retain NPC carryover; configured XP stays reader-writable. Stored character values are preserved.

The progression controls select XP and Level fields, a growth policy, and eligible numeric stats; NPC progression is configured per template. Locked stats can be selected for growth. Numeric defaults such as `6/10` define resource pools whose current value and capacity grow together, preserving depletion. A new NPC may initialize its own pool capacity: `5/5` stays `5/5`, and a bare initial `8` becomes `8/8`. Ordinary reader updates preserve that established capacity. Plain defaults such as `3` define ratings with a fixed maximum. Pool capacity limits are optional and independent of locking or carryover.

Under **Systems → Builder → Profile fields**, add, rename, reorder, retire, or restore profile fields. Use **Display as text section** for paragraphs, or leave it unchecked for compact badges. All profile value editors support multiple lines. Select **Include in image prompt** for any field that should describe portraits. Age and Appearance are selected by default; Appearance is optional, and custom visual fields work too. A field's ID stays stable when its label changes. Fill and manual lore generation can seed empty fields; manual edits and field regeneration can revise them. The tracker leaves profile and memory fields alone. Retired fields keep saved values. The memory limit is configurable per System and defaults to 50 active entries per character.

In **Systems → Manager → Generate from premise**, describe a game and optional preferences. The generator uses the reader connection by default, with an explicit connection override. It plans the rules, then fills profiles, stats, NPC templates, collections, progression, and rewards in sequential requests suited to local models. It validates each section and attempts one repair before offering a retry that preserves completed work. Regenerate uses the current inputs and starts over.

Review the summary and use **Edit draft** to adjust rules through the normal Builder controls. **Save as new System** requires a valid draft and a distinct name. Generation, editing, and saving do not activate the System or reset an adventure; select it deliberately when starting a new adventure. Cancellation stops subsequent steps and ignores late responses; a host API that cannot cancel its current request may finish that request in the background. Usage appears under **System Generation**. Local-model quality still needs evaluation on the chosen model and quantization.

A chat chooses its System before play starts and keeps it after the first player message. Systems define reusable rules and fields; the current cast and player state belong to the chat. The selected persona's identity, profile, and portrait carry across chats, while stats, items, and memories are kept per chat and persona.

**Export selected** on the Characters page previews which fields travel. Character files use version 2; older character files still import, with their mixed stat values classified by the destination System. Linked lore travels as text and can be recreated in the destination lorebook. Portrait paths are local to one installation, so exported files contain no portraits. **Export World Characters** retains each source chat and NPC ID in the file, allowing same-name NPCs from different chats to remain separate on import.

Player and NPC Cast pages share the same **Profile** and **Edit** layout. The Profile page groups profile description and linked lore in **Description & Lore**. They remain in their respective card and lorebook fields so existing writing is preserved.

---

## Menu Layout

Advanced settings and fine-tuning parameters remain hidden until **Show Every Setting** is enabled in the **Advanced** tab. Every page has a search box above it, so a setting can be found without knowing which tab it is on.

| Tab | Contents |
| :--- | :--- |
| **Characters** | Character cards, profiles, portraits, and roster categories |
| **Player** | The selected persona's profile, portrait, stats, items, memories, and level; also opens from the HUD |
| **Appearance** | Themes, speech dividers, spacing, avatar shapes, and fallback faces |
| **Writing Rules** | Dialogue format, narrator rules, ban list, and how replies are parsed |
| **Tracker** | Extraction passes, review settings, and history scans |
| **HUD** | Floating on-screen widget configuration and display modes |
| **Systems** | Reusable rules, player and NPC profile fields, update policies, and stat definitions |
| **Generation** | Automated lorebook creation and portrait generation settings |
| **Stats** | Token analytics and cost tracking for background LLM passes |
| **Advanced** | Master switches, console logging, and UI sizing |

---

## Development

`manifest.json` loads `index.js` and `style.css`. The JavaScript entry point imports
the feature modules in `src/`; the CSS entry point imports the ordered files in
`styles/`. There is no build step — clone the extension into
`public/scripts/extensions/third-party/` and reload.

Verbose logging is off by default. Turn it on in **Advanced -> Log Requests To The
Console**, or from DevTools:

```js
window.SILLYNPC_DEBUG = true;
```

### Source layout

| Path | Responsibility |
| --- | --- |
| `index.js`, `src/entry/` | Extension startup and SillyTavern event handlers |
| `src/core/`, `src/prompts/` | Settings, constants, helpers, and prompt rules |
| `src/chat/`, `src/characters/`, `src/lore/`, `src/story/` | Message decoration, character ownership, lore, and story history |
| `src/tracker/` | Current tracker state, extraction, review, memories, and XP |
| `src/ui/` | Settings, character sheets, HUD, and other views |
| `src/api/` | Lore and portrait generation and storage |
| `style.css`, `styles/*.css` | Ordered theme and interface styling |
| `tests/*.mjs` | Focused behavior tests |

See the [file map](docs/FILE_MAP.md) for every source file and its responsibility.

Run the focused tests with `node --experimental-default-type=module --test tests/*.mjs`. Tests are grouped by feature; shared generation data lives in `tests/fixtures/`. For live UI checks, use `python3 tests/ui-smoke.py` plus the relevant feature script (navigation, collections, or progression).

---

## License

[MIT](LICENSE)

### NPC templates

A System can contain multiple reusable NPC templates, such as Human, Elf, and Pokémon. In **Systems → NPC Templates**, name each template and describe which characters belong to it. Define stats and profile fields once in **Stats** and **Profile fields**, then use **Applies to** to assign them to the player, all NPCs, or selected templates. Each NPC uses one template and keeps its own values.

The background reader assigns an unassigned NPC when the story identifies its type. Uncertain assignments appear in review with a template dropdown, even when ordinary change review is disabled. Correct an assignment using **NPC template** on the character sheet. Assignments survive leaving and returning to the scene. New Systems have no fallback template; existing Systems retain their previous NPC schema as an editable **NPC** template so saved chats remain readable.
