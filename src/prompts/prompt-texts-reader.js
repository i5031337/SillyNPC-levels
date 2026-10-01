export const readerPromptTexts = [
    {
        id: 'levelBonusSystem', group: 'Tracker reader', label: 'Level bonus instructions',
        where: 'The system prompt sent when the tracker chooses a bonus after an XP level-up.',
        when: 'When XP crosses its cap in separate reader mode.',
        placeholders: {},
        text: 'Choose one story-appropriate player level bonus. Reply with one JSON object and no surrounding text.',
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
Choose exactly one bonus.
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
            minimalReply: 'A no-change reply listing the cast present.',
            changedReply: 'A numeric delta, using one of your configured player stat names.',
            numericDeltas: 'Existing numeric stats eligible for delta updates, by owner.',
            earlier: 'The messages before this one, when you send any.',
            message: 'The message being read.',
            reasons: 'Switch: on when "Ask for reasons" is on.',
            goals: 'Configured player and NPC goals, with current values and guidance.',
        },
        text: `Read the latest message and report its changes and the full scene cast. Use earlier messages only for context; their effects are already in the current state. Initialize every new NPC's blank configured stats with plausible individual values, even without story details. Do not report profile or memory changes.

### CONFIGURED STATS AND COLLECTIONS
Use the configured names below.

### CURRENT STATE
{{state}}
{{#npcFields}}

### NPC FIELDS TO INITIALIZE
{{npcFields}}
For each present NPC, initialize blank configured stats with plausible individual values, even without context. Respect allowed values and numeric limits. Update filled stats only when the latest message changes them. Initialize blank locked NPC stats once.
{{/npcFields}}
{{#xpProgression}}

### PLAYER EXPERIENCE
Award XP once for each concrete player accomplishment in the latest message, including small progress. Scale the award to the achievement. Report a positive number only in "player.deltas"; the extension handles Level and excess XP.
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
Use one delta per changed field. For a blank numeric field or changed maximum, use a replacement "stats" value, except for player XP: award XP only through a positive "player.deltas" number.
{{/numericDeltas}}
{{notes}}
{{#strangers}}

### STRANGERS
Speakers without cards: {{strangers}}. In "strangers", assign each the best matching kind from {{strangerKinds}}, or "".
{{/strangers}}
{{#collections}}

### COLLECTIONS AND THEIR FIELDS
{{collections}}
{{/collections}}
{{#collections}}

### WHEN A COLLECTION CHANGES
For a new NPC, add starting possessions shown in the story or background; infer plausible essentials when details are sparse.
Report each collection change shown in the latest message:
- "remove" for used, spent, transferred, lost, or destroyed items
- "add" for acquired items, with stated fields
- "update" for changed items, with their name and changed fields
{{/collections}}
{{#earlier}}

### EARLIER MESSAGES (reflected in state)
{{earlier}}
{{/earlier}}

### LATEST MESSAGE
{{message}}

{{#goals}}
### GOAL CHANGES
Configured fields and current goals:
{{goals}}
Only report an explicit, meaningful change in the latest message. Under the relevant actor's "goals", use a configured field key and an object with "action" ("set" for an empty field, "replace" for a changed goal, or "complete" for one finished or abandoned), "text" (new goal for set/replace; empty for complete), and "quote" (exact supporting words from the latest message). A goal is an actual objective the character pursues, not every promise, secret, invitation, or plot detail. Do not repeat unchanged goals.
{{/goals}}
### REPLY FORMAT
Return raw JSON with changed fields, initial values for blank NPC stats, and everyone present in "characters". Omit unchanged values. Keep replacement formats: "8/10" stays a pool; a plain number stays a plain number.
{{#reasons}}
Put "why" first. Key each reason by stat, such as "Time", "Player.Health", or "<name>.Health". Quote the latest message or name the event. For an initialized NPC stat, use "initial estimate" or "invented".
{{/reasons}}
{{#strangers}}
Stranger example: { {{strangerExample}} }.
{{/strangers}}
{{#collectionExample}}
Collection-change example:
{{collectionExample}}
{{/collectionExample}}
{{#minimalReply}}

No-change example:
{{minimalReply}}
{{/minimalReply}}
{{#changedReply}}

Numeric-change example:
{{changedReply}}
{{/changedReply}}`,
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
        text: `Update the status from the latest story events. Initialize every new NPC's blank configured stats with plausible individual values, even without context. List everyone present after the latest message.

### CURRENT STATUS
{{status}}

Rules: {{rules}}
{{#npcFields}}
NPC fields:
{{npcFields}}
For each present NPC, fill blank configured stats with plausible individual values. Respect allowed values and numeric limits. Update filled stats only when the story changes them. Initialize blank locked NPC stats once.
{{/npcFields}}
{{#xpProgression}}
Player XP: award once for each concrete accomplishment in the latest message, including small progress. Scale the award to the achievement. Report the new absolute XP total with the same cap (90/100 plus 20 becomes 110/100). The extension handles level-ups and excess XP. When the award crosses the cap, add a story-appropriate Level Bonus to the player sheet.
{{/xpProgression}}

### COSTS
Apply costs paid in the latest turn. Earlier costs are reflected in Current Status.
{{#limits}}

### STAT LIMITS
Player maximums: {{playerLimits}}
NPC maximums: {{npcLimits}}
Keep pool values such as "8/10" in that form. Change the maximum when the story changes it. Keep plain numbers as numbers.
{{/limits}}

{{#schemas}}
### COLLECTIONS
For a new NPC, add starting possessions shown in the story or background; infer plausible essentials when details are sparse.
Report collection changes:
- "add": [ { ...item fields } ] for gains
- "remove": [ "Item name" ] for spent, lost, transferred, or destroyed items
- "update": [ { ...name and changed fields } ] for changed items
For a transfer, remove the item from one owner's collection and add it to the other's. Both player and characters can have collections.
### COLLECTION SCHEMAS
{{schemas}}
{{/schemas}}

{{#sceneChange}}
After a scene change, list the characters who moved to the new scene.
{{/sceneChange}}
End your response with changes and initial values for blank NPC fields inside <status_update> tags.`,
    },
];
