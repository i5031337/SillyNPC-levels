export const readerPromptTexts = [
    {
        id: 'reader', group: 'Tracker reader', label: 'Reader request',
        where: 'The request the tracker\'s reader gets for each new message, after your Extraction Instructions (which are its system prompt).',
        when: 'Every message, when the tracker reads replies separately.',
        placeholders: {
            state: 'The scene as it stands, as JSON.',
            offstage: 'Tracked characters the message names who are not on stage, with what is on file for them.',
            limits: 'Editable stats, their meanings and text formats.',
            npcFields: 'All configured NPC fields, including their purpose and initialization rules.',
            xpProgression: 'Switch: on when a player or NPC has enabled progression.',
            notes: 'Notes other extensions add, each with its own heading.',
            strangers: 'Speakers without a card, when you have tagged fallback portraits.',
            strangerKinds: 'Your portrait tags.',
            strangerExample: 'One stranger paired with one tag.',
            collections: 'Each collection and the fields its items have.',
            collectionExample: 'A worked change in your own collection and field names.',
            minimalReply: 'A no-change reply listing the cast present.',
            changedReply: 'A configured example with player and NPC stats and collections.',
            newNpcReply: 'An NPC initialization template with configured stat and item field guidance, even with an empty scene.',
            numericDeltas: 'Existing numeric stats eligible for delta updates, by owner.',
            earlier: 'The messages before this one, when you send any.',
            message: 'The message being read.',
            reasons: 'Switch: on when "Ask for reasons" is on.',
            goals: 'Configured player and NPC goals, with current values and guidance.',
        },
        text: `Read the latest message and report its changes and the full scene cast. "characters" contains NPCs present in the scene, never the player; put all player changes under "player". Use earlier messages only for context; their effects are already in the current state. Initialize every new NPC's blank configured stats with plausible individual values, even without story details. Do not report profile or memory changes.

### CURRENT STATE
{{state}}
{{#collections}}

### COLLECTIONS AND THEIR FIELDS
{{collections}}
{{/collections}}
{{#newNpcReply}}

### NPC INITIALIZATION TEMPLATE
When an NPC enters the scene, include an object in the "characters" array with their exact "name", even when CURRENT STATE has no NPCs. Initialize blank configured fields under "stats", not "deltas"; preserve values already on file. Infer plausible individual values when the story gives no details.
The template's field values describe how to fill them, using the configured field guidance and constraints. Replace them with actual values. Include starting possessions under each collection's "add" array; omit collections with no starting items. Use exact field spelling and capitalization. The configured primary field identifies an item; no separate item "name" field is required.
{{newNpcReply}}
{{/newNpcReply}}
{{#xpProgression}}

### EXPERIENCE
Award experience once per concrete accomplishment in the latest message, including small progress, for the player and enabled NPC templates. Use each owner’s configured XP field in "player.deltas" or that character’s "deltas" with a positive number. The extension handles Level, excess XP, and reward proposals; never write Level or level-up growth directly. Disabled NPC templates use ordinary stat rules.
{{/xpProgression}}
{{#offstage}}

### OFFSTAGE CHARACTERS
These known characters are outside the current scene. If one enters, include them in "characters" without "offstage" (or with false). If they remain absent but the latest message establishes an earned XP award or other concrete change, include them with "offstage": true and only those changes. Use positive XP deltas for enabled progression. Never mark an unknown NPC offstage, and never infer scene presence from merely mentioning a name.
{{offstage}}
{{/offstage}}
{{#limits}}

### EDITABLE STATS
Only change these stats:
{{limits}}
{{/limits}}
{{#numericDeltas}}

### NUMERIC CHANGES
For an existing numeric value, report the amount gained or lost as a JSON number. Use "globalDeltas" for world stats, "player.deltas" for player stats, and "characters[].deltas" for NPC stats. Eligible fields:
{{numericDeltas}}
Use one delta per changed field. For blank stats, supply initial values under "stats" (world values under "global").
{{/numericDeltas}}
{{notes}}
{{#strangers}}

### STRANGERS
Speakers without cards: {{strangers}}. In "strangers", assign each the best matching kind from {{strangerKinds}}, or "".
{{/strangers}}

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
Return raw JSON with changed fields, initial values for blank NPC stats, and every NPC present in "characters". Never list the player there. Omit unchanged values. Keep replacement formats: "8/10" stays a pool; a plain number stays a plain number.
"characters" must be an array of objects, each with a "name" field containing the exact NPC name. Do not use an object keyed by NPC names. If no NPC is present and no known offstage NPC changes, use "characters": []. Known absent NPC updates must carry "offstage": true; all other entries describe the complete present cast.
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

Changed-reply shape (include only changes supported by the latest message):
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
            statDefinitions: 'Configured stat purposes, types and bounds.',
            schemas: 'Each collection in play and its fields.',
            npcFields: 'All configured NPC fields, including allowed values and locked fields.',
            xpProgression: 'Switch: on when a player or NPC has enabled progression.',
        },
        text: `Update the status from the latest story events. Initialize every new NPC's blank configured stats with plausible individual values, even without context. List everyone present after the latest message.

### CURRENT STATUS
{{status}}

Rules: {{rules}}
{{#statDefinitions}}
### STAT DEFINITIONS
{{statDefinitions}}
{{/statDefinitions}}
{{#npcFields}}
NPC fields:
{{npcFields}}
For each present NPC, fill blank configured stats with plausible individual values. Follow each stat's purpose and rules. Update filled stats only when the story changes them. Initialize blank locked NPC stats once.
{{/npcFields}}
{{#xpProgression}}
Experience: award once per concrete accomplishment for the player and enabled NPC templates. Report earned XP as a positive delta under "player.deltas" or that character’s "deltas", using the configured XP field. The extension handles Level, excess XP, stat growth, and collection reward review. Never write Level or level-up growth directly. Disabled templates use ordinary stat rules.
{{/xpProgression}}

### COSTS
Apply costs paid in the latest turn. Earlier costs are reflected in Current Status.
Keep pool values such as "8/10" in that form. Keep maxima fixed during ordinary updates. Configured level growth may increase Turn pool capacity, within an explicit capacity limit. The level-up system proposes growth separately; never include it in story updates. Advancement ratings keep their configured range. Keep plain numbers as numbers.

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

End your response with changes and initial values for blank NPC fields inside <status_update> tags.`,
    },
];
