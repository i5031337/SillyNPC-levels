export const readerPromptTexts = [
    {
        id: 'reader', group: 'Tracker reader', label: 'Reader request',
        where: 'The request the tracker\'s reader gets for each new message, after your Extraction Instructions (which are its system prompt).',
        when: 'Every message, when the tracker reads replies separately.',
        placeholders: {
            playerName: 'The active player persona’s name.',
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
            newNpcReply: 'A new NPC reply example with configured stat and item field guidance, even with an empty scene.',
            numericDeltas: 'Existing numeric stats eligible for delta updates, by owner.',
            earlier: 'The messages before this one, when you send any.',
            message: 'The message being read.',
            reasons: 'Switch: on when "Ask for reasons" is on.',
        },
        text: `Read the latest message and report its changes and the full scene cast. "characters" contains NPCs present in the scene, never the player; put all player changes under "player". Use earlier messages only for context; their effects are already in the current state. Initialize every new NPC's blank configured stats with plausible individual values, even without story details. Do not report profile or memory changes.

{{#playerName}}
{{playerName}} is the player-controlled character. References to {{playerName}} belong under player.
{{/playerName}}

### INFERRING EFFECTS FROM PROSE
Use only configured stats and collections. Their purposes and rules determine how resolved story events affect them, even when the narrator gives no field names or numbers. Use configured rules, established effects and costs, and earlier context first. If an effect on a configured field is clear but no amount is given, estimate a conservative amount using the field's current scale and the narrated event. Missing numbers do not mean an established effect should be ignored. Preserve established pool maxima and filled locked stats.
Plans, requests, and unresolved attempts do not establish their intended outcomes. Apply only effects supported by what actually happened. For text fields, infer values within the configured meaning and allowed choices. Follow configured persistence and reset rules; a scene change alone does not establish a reset.

### CURRENT STATE
{{state}}
{{#collections}}

### COLLECTIONS AND THEIR FIELDS
{{collections}}
Use the quoted collection ID as the JSON key under "collections", never its display label. Use exact field spelling and capitalization. Include the configured primary field in every "add" and "update" entry, using its declared type; "remove" lists those same identifiers. A separate item "name" is unnecessary unless it is the configured primary field.
{{/collections}}
{{#npcFields}}

### NPC INITIALIZATION FIELDS
Initialize blank fields only, including locked fields. Preserve filled locked fields; never report deltas for them.
{{npcFields}}
{{/npcFields}}
{{#newNpcReply}}

### NEW NPC REPLY EXAMPLE
When an NPC enters the scene, include an object in the "characters" array with their exact "name", even when CURRENT STATE has no NPCs. Initialize blank configured fields under "stats", not "deltas"; preserve values already on file. Infer plausible individual values when the story gives no details.
The example's stat values describe how to fill them, using the configured field guidance and constraints. Replace them with actual string readings. Collection item values illustrate their declared types; replace them with actual item values. Include starting entries consistent with each collection's purpose under its "add" array; omit collections with no starting entries. Use exact field spelling and capitalization. The configured primary field identifies an item; no separate item "name" field is required.
{{newNpcReply}}
{{/newNpcReply}}
{{#xpProgression}}

### EXPERIENCE
Award experience once per concrete accomplishment in the latest message, including small progress, for the player and NPCs with enabled progression. Use each owner’s configured XP field in "player.deltas" or that character’s "deltas" with a positive number. The extension handles Level, excess XP, and reward proposals; never write Level or level-up growth directly. NPCs without progression use ordinary stat rules.
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
For a new NPC, add starting entries shown in the story or background; infer plausible essentials only where consistent with the configured collection's purpose and rules.
Report each collection change shown in the latest message:
- "remove" for consumed, spent, transferred, lost, or destroyed items
- "add" for acquired items or newly demonstrated knowledge and abilities, if absent from the owner's current collection
- "update" for changed items, with their configured primary field and changed fields
Follow each collection's configured purpose. If it tracks abilities or knowledge, an actor's actual use of a named ability establishes knowledge even if the intended outcome fails. Add it to their applicable configured collection when missing; no explicit learning announcement is needed, even for an already tracked actor. A command or mere mention alone does not prove the actor knows it. Keep reusable entries after use; update configured item fields only when supported by the event. Follow collection targets and field guidance, include supported item details, and omit unknown optional fields. Do not create collections or duplicate entries already held.
{{/collections}}
{{#earlier}}

### EARLIER MESSAGES (reflected in state)
{{earlier}}
{{/earlier}}

### LATEST MESSAGE
{{message}}

### REPLY FORMAT
Return raw JSON with changed fields, initial values for blank NPC stats, and every NPC present in "characters". Never list the player there. Omit unchanged values. Absolute readings under "stats" and "global" are JSON strings: "8", "8/10", or "<configured text value>". Numeric changes under "deltas" and "globalDeltas" are JSON numbers: -2 or 5. Collection fields use their declared types.
"characters" must be an array of objects, each with a "name" field containing the exact NPC name. Do not use an object keyed by NPC names. If no NPC is present and no known offstage NPC changes, use "characters": []. Known absent NPC updates must carry "offstage": true; all other entries describe the complete present cast.
{{#reasons}}
Put "why" first. Key each reason by configured field: "<world stat>", "Player.<stat>", or "<NPC name>.<stat>", or by owner and configured collection for an item change. Replace placeholders with exact configured names. Quote the latest message or name the event; when estimating an amount, briefly identify the narrated effect and that the amount is estimated. For an initialized NPC stat, use "initial estimate" or "invented".
{{/reasons}}
{{#strangers}}
Stranger example: { {{strangerExample}} }.
{{/strangers}}
{{#collectionExample}}
Independent collection-change examples (each shows a separate event). Replace illustrative values and placeholders with actual values of the declared types and include only fields established by the message. Put the collection object under the owner's "collections":
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
Experience: award once per concrete accomplishment for the player and enabled NPC templates. Report earned XP as a positive delta under "player.deltas" or that character’s "deltas", using the configured XP field. The extension handles Level, excess XP, stat growth, and collection reward review. Initialize a blank NPC Level once from the story; otherwise never write Level or level-up growth directly. Disabled templates use ordinary stat rules.
{{/xpProgression}}

### STAT CHANGES
Use only configured stats and collections. Infer effects from resolved actions and narrated consequences according to each field's purpose and rules; explicit field names and numbers are unnecessary. Follow configured rules and established effects or costs first. If an effect on a configured field is clear but has no stated amount, estimate a conservative change using its current scale and the narrated event. Missing numbers do not mean an established effect should be ignored. Plans, requests, and unresolved attempts do not establish their intended outcomes. Preserve filled locked stats. Follow configured persistence and reset rules; a scene change alone does not establish a reset. Earlier effects are reflected in Current Status.
For configured pools, initialize new NPCs with individual capacities, even when they differ from the default: "5/5" stays "5/5", and a bare initial "8" means "8/8". Keep pool values such as "8/10" in that form. Keep established maxima fixed during ordinary updates. Where progression is enabled, configured level growth may increase pool capacity within an explicit capacity limit. The level-up system proposes growth separately; never include it in story updates. Plain numeric ratings keep their configured range. Absolute readings under "stats" and "global" are JSON strings: "8", "8/10", or "<configured text value>". Numeric changes under "deltas" and "globalDeltas" are JSON numbers: -2 or 5. Collection fields use their declared types.

{{#schemas}}
### COLLECTIONS
For a new NPC, add starting entries shown in the story or background; infer plausible essentials only where consistent with the configured collection's purpose and rules.
Report collection changes:
- "add": [ { ...item fields } ] for gains
- "remove": [ <configured primary field value> ] for spent, lost, transferred, or destroyed items
- "update": [ { ...configured primary field and changed fields } ] for changed items
For a transfer, remove the item from one owner's collection and add it to the other's. Both player and characters can have collections.
Follow each collection's configured purpose. For knowledge or ability collections, add a named ability when its actual use establishes that the actor knows it and it is missing from their applicable collection, even if its intended outcome fails. No explicit learning announcement is needed. Commands and mere mentions are insufficient. Keep reusable entries after use; remove entries only when their loss is established. Use configured fields and targets, omit unknown optional details, and avoid duplicate entries.
### COLLECTION SCHEMAS
{{schemas}}
{{/schemas}}

End your response with changes and initial values for blank NPC fields inside <status_update> tags.`,
    },
];
