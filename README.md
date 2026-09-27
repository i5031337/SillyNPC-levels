<p align="center">
  <img src="img/SillyNPCLogo.jpg" alt="SillyNPC" width="420">
</p>

# SillyNPC XP

For the source layout and each file's responsibility, see the [file map](docs/FILE_MAP.md).

This fork adds automatic player XP progression and chat-owned NPCs to SillyNPC. Install it **instead of**
the original extension; both use the same settings and events and must not run together.

With the Status Tracker enabled, the reader can award XP for concrete accomplishments
in the latest story message, including useful item acquisitions, resolved challenges,
and successful NPC interactions. It reports the new absolute XP total. For example,
an award of 20 when XP is `90/100` is reported as `110/100`.

The extension then automatically advances Level to 2 and stores `10/100` XP. The
current XP maximum stays the threshold for subsequent levels, and large awards can
cross multiple levels. On a level-up in separate extraction mode, the reader makes
an additional request to choose a story-appropriate bonus. It may increase an
existing numeric player stat by 1–5, or write a narrative perk. The latest bonus
appears in the player's `Level Bonus` field. In inline mode, the narrator is asked
to supply that field with its status update. If no bonus can be read from the LLM,
the level-up still occurs; the bonus can be entered on the player sheet.

XP awards are model judgments and can be corrected on the player sheet. Each award
should correspond to an accomplishment in the latest message; events already counted
should not be awarded again. The tracker review settings still govern proposed
changes, including a review mode that holds all changes for approval.

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
* **Comprehensive State Model:** Tracks attributes, resource pools (HP/Energy by default), conditions, inventory, and any collection you define.
* **Dedicated Extraction Pass:** Processes state updates in a background pass to keep tracker logic from polluting the primary prompt context.
* **Review Before Applying:** Risky changes — items gained or lost, implausible jumps — wait in a panel under the message that proposed them instead of applying silently.
* **Interactive Sheets:** Detailed character sheet modal for inspecting and manually editing stats, appearance, and inventory.

### Open Threads
* **Nothing Gets Forgotten:** Promises, threats, debts, secrets, deadlines and plans are caught as they are made and sent with every message until they are settled.
* **Kept With Their Source:** Each thread stores the line it came from, so one the reader invented is visible at a glance.

### Floating HUD
* **Four Meter Styles:** Bars, segmented bars, rings around the portrait, or text only.
* **Real-Time Updates:** Syncs automatically as the background tracker extracts new values from the narrative.

### Character & World Management
* **Roster Categories:** Organize characters into distinct worlds, factions, or scenes — and limit a chat to only the categories it needs.
* **Chat-Owned NPCs:** New characters created in a chat belong to that chat, survive persona changes, and do not appear in unrelated chats. Legacy world cards remain available as reusable sources; **Use in this chat** creates an independent instance.
* **Portable Character Files:** Export identity, profile, linked lore text, and Innate stats. Variable stats, conditions, and inventory start from the destination System's defaults on import. Portrait image files are omitted from character exports.
* **Export World Characters:** Under **Systems → Manager**, export reusable world cards and NPCs from every chat assigned to a Saved System, including chats that are closed and Systems that are not active. The existing full System export is still available separately.
* **Integrated Generation:** Generates matching lorebook entries and portraits directly via connected APIs.

### Theming & Analytics
* **Built-in Themes:** Seamless Native, Terminal, Cyberpunk, Monochrome, Modern Dark, Fantasy HUD, Tabletop Parchment, Analog Horror, and Rosewater.
* **Token Tracking:** Monitors token consumption, instruction costs, and average usage across tracker extractions, lore generation, and history scans.
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
   * Click an unknown speaker's placeholder portrait to create its chat-owned card and start Fill immediately. Fill writes missing lore, profile details, tracker fields, and belongings; completed stages remain in place if a later stage fails. Open the card and press **Fill** to retry.
   * Use the adjacent **Link as alias** button if the speaker is another name for an existing NPC. Clicking an existing card's portrait opens its editor.
   * Portrait generation is off in automatic Fill by default because it can incur a separate API cost. Enable **Draw Portrait Automatically** under **Generation → Unknown Speaker Fill**, or add a portrait in the editor.
3. **Enabling Tracker & HUD:**
   * The tracker is **on by default** for new settings. If it is not reading messages, check **Enable Status Tracker** under the **Tracker** tab; previously saved settings may have it off.
   * The HUD appears once the tracker is running; choose a meter style under the **HUD** tab.

### NPC stats and character transfers

In **Systems → Builder → NPC**, set each stat to **Innate** or **Variable**. Innate values travel with a character and the tracker may initialize one only while it is blank; later changes require a manual edit. Variable values can change during the adventure and reset to the destination System's defaults when a character is imported or instantiated from a reusable world card. Shipped HP, Energy, and Condition fields are Variable. Existing custom fields keep their stored values and show a review note until you choose their transfer behavior.

**Export selected** on the Characters page previews which fields travel. Character files use version 2; older character files still import, with their mixed stat values classified by the destination System. Linked lore travels as text and can be recreated in the destination lorebook. Portrait paths are local to one installation, so exported files contain no portraits. **Export World Characters** retains each source chat and NPC ID in the file, allowing same-name NPCs from different chats to remain separate on import.

The NPC page groups profile description and linked lore in **Description & Lore**. They remain in their respective card and lorebook fields so existing writing is preserved.

---

## Menu Layout

Advanced settings and fine-tuning parameters remain hidden until **Show Every Setting** is enabled in the **Advanced** tab. Every page has a search box above it, so a setting can be found without knowing which tab it is on.

| Tab | Contents |
| :--- | :--- |
| **Characters** | Character cards, profiles, portraits, and roster categories |
| **Appearance** | Themes, speech dividers, spacing, avatar shapes, and fallback faces |
| **Writing Rules** | Dialogue format, narrator rules, ban list, and how replies are parsed |
| **Threads** | Active plotlines, promises, debts, secrets, and deadlines |
| **Tracker** | Extraction passes, review settings, time rules, and history scans |
| **HUD** | Floating on-screen widget configuration and display modes |
| **Systems** | Custom attribute definitions, stat limits, and world presets |
| **Generation** | Automated lorebook creation and portrait generation settings |
| **Prompts** | Review prompt templates, token budgets, and injection depth |
| **Stats** | Token analytics and cost tracking for background LLM passes |
| **Advanced** | Master switches, console logging, backups, and UI sizing |

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
| `src/tracker/` | Tracker state, extraction, reviews, history, and XP |
| `src/ui/` | Settings, character sheets, HUD, and other views |
| `src/api/` | Lore and portrait generation and storage |
| `style.css`, `styles/*.css` | Ordered theme and interface styling |
| `tests/*.mjs` | Focused behavior tests |

See the [file map](docs/FILE_MAP.md) for every source file and its responsibility.

Run the focused tests with `node --experimental-default-type=module --test tests/*.mjs`.

---

## License

[MIT](LICENSE)
