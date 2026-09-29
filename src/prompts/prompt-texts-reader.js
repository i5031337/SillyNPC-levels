export const readerPromptTexts = [
    {
        id: 'levelBonusSystem', group: 'Tracker reader', label: 'Level bonus instructions',
        where: 'The system prompt sent when the tracker chooses a bonus after an XP level-up.',
        when: 'When XP crosses its cap in separate reader mode.',
        placeholders: {},
        text: 'Choose one player level bonus. Reply with exactly one valid JSON object. Do not include reasoning, markdown, code fences, or any text before or after the JSON.',
    },
    {
        id: 'levelBonus', group: 'Tracker reader', label: 'Level bonus request',
        where: 'The request sent when the tracker chooses a bonus after an XP level-up.',
        when: 'When XP crosses its cap in separate reader mode.',
        placeholders: {
            level: 'The new player level.',
            state: 'The current scene and player sheet as JSON.',
            sheet: 'The current player sheet (for older custom prompt templates).',
            offstage: 'Named tracked characters outside the scene.',
            limits: 'Configured stat limits and allowed values.',
            collections: 'Configured collections and their fields.',
            notes: 'Additional reader context registered by other extensions.',
            earlier: 'Recent messages, already reflected in the current state.',
            message: 'The latest story event.',
            pendingChanges: 'The tracker update that triggered this level-up.',
            eligible: 'Numeric stats the bonus may raise.',
        },
        text: `The player reached level {{level}}.
Current player stats: {{sheet}}
Latest story message: {{message}}
Eligible numeric stats: {{eligible}}
Choose exactly one story-appropriate bonus. Return only one JSON object, with double-quoted keys and strings. Do not explain your choice outside the JSON.
For a narrative perk, reply in this shape: {"description":"A short, specific perk tied to the story"}
For a numeric increase, choose a name from Eligible numeric stats and reply in this shape: {"description":"A short description of the improvement","stat":"Exact eligible stat name","amount":1}
Use an integer from 1 to 5 for amount. If there are no eligible numeric stats, choose a narrative perk.`,
    },
    {
        id: 'reader', group: 'Tracker reader', label: 'Reader request',
        where: 'The request the tracker\'s reader gets for each new message, after your Extraction Instructions (which are its system prompt).',
        when: 'Every message, when the tracker reads replies separately.',
        placeholders: {
            state: 'The scene as it stands, as JSON.',
            offstage: 'Tracked characters the message names who are not on stage, with what is on file for them.',
            limits: 'Ranges, allowed values and how each field is written, from System Builder.',
            locked: 'Locked stats in System Builder.',
            npcFields: 'All configured NPC fields, including allowed values and locked fields.',
            xpProgression: 'Switch: on when the player has XP and Level stats.',
            notes: 'Notes other extensions add, each with its own heading.',
            strangers: 'Speakers without a card, when you have tagged fallback portraits.',
            strangerKinds: 'Your portrait tags.',
            strangerExample: 'One stranger paired with one tag.',
            collections: 'Each collection and the fields its items have.',
            collectionExample: 'A worked change in your own collection and field names.',
            profileFields: 'System profile fields the reader may update, with their policies.',
            minimalReply: 'A no-change reply listing the cast present.',
            changedReply: 'A numeric delta, using one of your configured player stat names.',
            numericDeltas: 'Existing numeric stats eligible for delta updates, by owner.',
            earlier: 'The messages before this one, when you send any.',
            message: 'The message being read.',
            reasons: 'Switch: on when "Ask for reasons" is on.',
            goals: 'Configured player and NPC goals, with current values and guidance.',
        },
        text: `### CONFIGURED STATS AND COLLECTIONS
Use the stats in the current state and NPC fields, and the collections listed below.

### CURRENT STATE
{{state}}
{{#npcFields}}

### NPC FIELDS TO INITIALIZE
{{npcFields}}
For each NPC present in the latest message, fill blank fields. For a new NPC, initialize fields without defaults. Use the story and background, or invent individual, plausible values. Respect allowed values and numeric limits. Include filled fields when the story changes them. Initialize blank Locked NPC fields once.
{{/npcFields}}
{{#xpProgression}}

### PLAYER EXPERIENCE
Award XP for concrete player progress in the latest message, including small successes: learning a useful clue, making headway on a task, helping someone, practicing a skill, acquiring an item, or overcoming a challenge. Minor progress earns a small award; major achievements earn more. Do not wait for a major milestone. Award each accomplishment once, only when it happens in the latest message; earlier messages are already reflected in the current state. Put earned XP only in "player.deltas" as a positive JSON number: at 90/100 XP, earning 20 gives "player": { "deltas": { "XP": 20 } }. Never put XP in "player.stats" or report an absolute XP total. The extension handles Level, Level Bonus, and excess XP.
{{/xpProgression}}
{{#offstage}}

### OFFSTAGE CHARACTERS
These tracked characters are named in the message. Include one in "characters" if they enter the scene, with changes and initial values for blank NPC fields.
{{offstage}}
{{/offstage}}
{{#limits}}

### LIMITS
{{limits}}
{{/limits}}
{{#locked}}

### PLAYER-CONTROLLED FIELDS
Report updates for other fields. Initialize a blank Locked NPC field once; the player sets its later values.
{{locked}}
{{/locked}}
{{#numericDeltas}}

### NUMERIC CHANGES
For an existing numeric value, report the amount gained or lost as a JSON number. Use "globalDeltas" for world stats, "player.deltas" for player stats, and "characters[].deltas" for NPC stats. Eligible fields:
{{numericDeltas}}
Example: an Energy cost of 3 is "deltas": { "Energy": -3 }.
Use one delta per changed field. For a blank numeric field or changed maximum, use a replacement "stats" value, except for player XP: award XP only through a positive "player.deltas" number.
{{/numericDeltas}}
{{notes}}
{{#strangers}}

### STRANGERS
Speakers without cards: {{strangers}}. In "strangers", assign each the best matching kind from {{strangerKinds}}, or "". Example: { {{strangerExample}} }.
{{/strangers}}
{{#collections}}

### COLLECTIONS AND THEIR FIELDS
{{collections}}
{{/collections}}
{{#collections}}

### WHEN A COLLECTION CHANGES
For each new NPC absent from current state, initialize relevant collections with their starting possessions, especially clothing and equipment. Use items shown in the story or character background, and infer a few plausible items when details are sparse. Report them as "add" entries under that character's "collections", using the configured collection names and item fields. This first appearance counts as a collection change.
Report each collection change shown in the latest message:
- "remove" for used, spent, transferred, lost, or destroyed items
- "add" for acquired items, with stated fields
- "update" for changed items, with their name and changed fields
{{/collections}}
{{#collectionExample}}

### A COLLECTION CHANGE LOOKS LIKE THIS
{{collectionExample}}
For new NPC starting items, use supported details from the story or character background and plausible inferred details. For later changes, include fields stated in the message.
{{/collectionExample}}
{{#profileFields}}

### PROFILE FIELDS YOU MAY UPDATE
For a replaceable field, report a new value under "profile" only when the latest message changes it. Put an exact supporting quote from that message under "profileEvidence" with the same field key. For a memory field, append a distinct event under "memories" as {"fieldId":"...","text":"...","quote":"exact words from latest message"}. Never rewrite a memory field under "profile". Omit anchored fields entirely. The reader cannot alter existing memories.
{{profileFields}}
{{/profileFields}}
{{#minimalReply}}

### WHEN NOTHING CHANGES, REPLY LIKE THIS
{{minimalReply}}
List everyone present. Empty objects show an unchanged status.
{{/minimalReply}}
{{#changedReply}}

### WHEN ONE NUMERIC PLAYER STAT CHANGES, REPLY LIKE THIS
{{changedReply}}
Use the amount shown in the latest message. When reasons are enabled, quote that message.
{{/changedReply}}
{{#earlier}}

### EARLIER MESSAGES (reflected in state)
{{earlier}}
{{/earlier}}

### LATEST MESSAGE
{{message}}

### TASK
Return JSON with changes from the latest message and the complete scene cast.
{{#collections}}
Use "add", "remove", and "update" for collection changes.
{{/collections}}
Keep initial and replacement value formats: "8/10" stays a pool; a plain number stays a plain number.
{{#reasons}}
Put "why" first in the JSON object. For each change, use a short quote from the latest message or a short clause naming the event. Key it by stat: "Time" for a world stat, "Player.Health" for the player, "<name>.Health" for a character. For an initialized NPC field, say "initial estimate" with context, or "invented".
{{/reasons}}
{{#goals}}
### GOAL CHANGES
Configured fields and current goals:
{{goals}}
Only report an explicit, meaningful change in the latest message. Under the relevant actor's "goals", use a configured field key and an object with "action" ("set" for an empty field, "replace" for a changed goal, or "complete" for one finished or abandoned), "text" (new goal for set/replace; empty for complete), and "quote" (exact supporting words from the latest message). A goal is an actual objective the character pursues, not every promise, secret, invitation, or plot detail. Do not repeat unchanged goals.
{{/goals}}
{{#xpProgression}}

Before replying, check the latest message for small as well as major player progress. Include a positive XP number in "player.deltas" for any concrete accomplishment not already counted in the current state; scale it to the achievement and award it once. Do not include XP in "player.stats".
{{/xpProgression}}

Report changed fields and initial values for blank NPC fields.`,
    },

    {
        id: 'storyBlock', group: 'Story model', label: 'Tracker block',
        where: 'Put into the story prompt, in the chat, telling the story model to write the status update itself.',
        when: 'Every message, only when the tracker updates inline (not with a separate reader).',
        placeholders: {
            status: 'The scene block (see Scene block).',
            rules: 'Your System Rules & Logic.',
            limits: 'Switch: on when any stat has a maximum.',
            playerLimits: 'The player\'s maximums.',
            npcLimits: 'The characters\' maximums.',
            schemas: 'Each collection in play and its fields.',
            npcFields: 'All configured NPC fields, including allowed values and locked fields.',
            sceneChange: 'Switch: on when a scene stat is set.',
            xpProgression: 'Switch: on when the player has XP and Level stats.',
        },
        text: `### STATUS TRACKER ACTIVE
Update the status from the latest story events.
Current Status:
{{status}}

Current Status records the present scene and possessions. Include an acquired item when the latest message shows its acquisition.

Rules: {{rules}}
{{#npcFields}}
NPC fields:
{{npcFields}}
For each present NPC, fill blank fields with plausible individual values from context or invention. For a new NPC, initialize fields without defaults. Respect allowed values and numeric limits. Update filled fields when the story clearly changes them. Initialize blank Locked NPC fields once.
{{/npcFields}}
{{#xpProgression}}
Player XP: award XP for concrete progress in the latest message, including small successes such as a useful clue, progress on a task, helping someone, practicing a skill, or acquiring an item. Scale the award to the accomplishment; do not wait for a major milestone. Award each accomplishment once, only when it happens in the latest message. Report the new absolute XP total with the same cap (90/100 plus 20 becomes 110/100). The extension handles level-ups and excess XP. When the award crosses the cap, add a story-appropriate Level Bonus to the player sheet.
{{/xpProgression}}

### COSTS
Apply costs paid in the latest turn. Earlier costs are reflected in Current Status.
{{#limits}}

### STAT LIMITS
Player maximums: {{playerLimits}}
NPC maximums: {{npcLimits}}
Keep pool values such as "8/10" in that form. Change the maximum when the story changes it. Keep plain numbers as numbers.
{{/limits}}

### COLLECTIONS
For each new NPC absent from Current Status, initialize relevant collections with starting possessions, especially clothing and equipment. Use story and character background details, and infer a few plausible items when details are sparse. Add them under that character's "collections" using the configured collection names and item fields.
Report collection changes:
- "add": [ { ...item fields } ] for gains
- "remove": [ "Item name" ] for spent, lost, transferred, or destroyed items
- "update": [ { ...name and changed fields } ] for changed items
For a transfer, remove the item from one owner's collection and add it to the other's. Both player and characters can have collections.
{{#schemas}}

### COLLECTION SCHEMAS
{{schemas}}
{{/schemas}}

Include every character currently present in the "characters" array.
{{#sceneChange}}
After a scene change, list the characters who moved to the new scene.
{{/sceneChange}}
End your response with changes and initial values for blank NPC fields inside <status_update> tags.`,
    },
];
