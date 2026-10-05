export const DEFAULT_INLINE_RULES = 'Change stats only when the story supports it. Apply a cost once, when the action resolves.';

export const defaultTrackerSettings = {
        enabled: true,
        showOnlyAtBottom: false,
        globalStats: [
            { name: 'Location', defaultValue: 'Unknown', format: '<b>{{name}}:</b> {{value}}', visible: true },
            { name: 'Time', defaultValue: 'Morning', format: '<b>{{name}}:</b> {{value}}', visible: true },
            { name: 'Quest', defaultValue: 'None', format: '<b>{{name}}:</b> {{value}}', visible: true }
        ],
        showGlobalStats: true,
        showPlayerStats: true,
        showNpcStats: true,
        showRawTrackerOutput: true,
        npcStats: [
            { name: 'HP', type: 'number', defaultValue: '10/10', format: '{{name}}: {{value}}', maxStatValue: '10', visible: true },
            { name: 'Energy', type: 'number', defaultValue: '5/5', format: '{{name}}: {{value}}', maxStatValue: '5', visible: true },
            { name: 'Condition', defaultValue: 'Healthy', format: '{{value}}', maxStatValue: '', visible: true }
        ],
        playerStats: [
            { name: 'HP', type: 'number', defaultValue: '20/20', format: '{{name}}: {{value}}', maxStatValue: '20', visible: true, isPrimary: true, color: '#e03131', advanceOnLevel: true },
            { name: 'Energy', type: 'number', defaultValue: '10/10', format: '{{name}}: {{value}}', maxStatValue: '10', visible: true, isPrimary: true, color: '#3b5bdb', advanceOnLevel: true },
            { name: 'Level', type: 'number', defaultValue: '1', format: '{{name}}: {{value}}', maxStatValue: '', visible: true, isPrimary: false },
            { name: 'XP', type: 'number', defaultValue: '0/100', format: '{{name}}: {{value}}', maxStatValue: '100', visible: true, isPrimary: false }
        ],
        collections: [
            { 
                id: 'inventory', 
                name: 'Inventory', 
                fields: [
                    { name: 'name', label: 'Name', type: 'text', isPrimary: true, defaultValue: '' },
                    { name: 'quantity', label: 'Quantity', type: 'number', isPrimary: false, defaultValue: '1' },
                    { name: 'description', label: 'Description', type: 'text', isMultiline: true, isPrimary: false, defaultValue: '' }
                ], 
                targets: ['player', 'npc'],
                includeInImagePrompt: true,
            }
        ],
        summaryThreshold: 5,
        /** Show each NPC's card portrait in the tracker box. */
        showNpcPortraits: true,
        /** The characters in equal columns across the box rather than one per line. */
        characterColumns: false,
        /**
         * How the tracker learns what changed.
         * 'extract' - a separate request reads the finished message and returns JSON.
         *             The narrative prompt then carries no tracker instructions, so a
         *             character card that forbids status output stops conflicting.
         * 'manual'  - the same separate request, started from the send bar only.
         * 'inline'  - the original behaviour: ask for a <status_update> block in the
         *             same response as the narrative.
         */
        extractionMode: 'extract',
        /** Write a profile when the separate reader discovers an NPC without a card. */
        autoGenerateNpcProfiles: false,
        /** Connection Manager profile for the extraction request. Empty = main API. */
        extractionProfileId: '',
        /** Token budget for the extraction reply. */
        extractionMaxTokens: 1200,

        /**
         * What the reader is told to be: 0 for as steady as the model gets, higher for more
         * variety. Empty leaves it to the model, which is what was sent before this existed.
         * Only reaches a model through the tracker's own connection profile; the main API
         * uses whatever its own settings say.
         */
        extractionTemperature: '',

        /**
         * Whether each message of the history carries the world as it stood at that message,
         * from the snapshot the tracker already saves. Off by default: it is the one setting
         * that grows with the length of the context.
         */
        historyNotes: false,

        /**
         * The world fields left OUT of those notes, by name. Kept as what to leave out, so a
         * field added later is shown without anybody going back to tick it.
         *
         * @type {string[]}
         */
        historyNoteSkip: [],
        /**
         * How many preceding messages the extraction sees as context.
         *
         * Play often announces a cost, takes a roll, then resolves - three messages -
         * and a card that forbids numbers in prose means the resolving message names no
         * figure. One message at a time cannot join those up. 2 covers announce/roll.
         */
        extractionContextMessages: 2,
        /**
         * Which proposed changes wait for you.
         * 'risky' - additions, removals and implausible jumps ask; the rest apply.
         * 'all'   - nothing applies until you say so.
         * 'off'   - everything applies; undo is the safety net.
         */
        reviewMode: 'off',
        /**
         * Whether the reader may move a ceiling on its own.
         * 'free'              - yes, shown but never blocking. Level-up rules vary too
         *                       much between systems to gate by default.
         * 'review-decreases'  - a ceiling going down asks; going up does not.
         * 'review-all'        - any ceiling change asks.
         */
        maxChangePolicy: 'free',
        /** A value moving more than this fraction of its range in one turn asks. */
        reviewSwingThreshold: 0.6,
        /** Show the history-scan button on the send bar. */
        scanButtonEnabled: true,
        /**
         * How many recent messages a scan reads. 0 reads the whole chat.
         * Recent messages are what decide the final state, so the budget is spent there
         * first when both limits bite.
         */
        scanDepth: 50,
        /** Hard ceiling on transcript size, so one enormous message cannot blow the context. */
        scanCharBudget: 60000,
        /**
         * Reply budget for a scan, separate from the per-message one.
         *
         * A scan lists whole inventories for several characters at once, where an update
         * reports the one stat that moved. Sharing the per-message budget truncated the
         * reply mid-object at 1200 tokens.
         */
        scanMaxTokens: 3000,
        /**
         * How many passes a scan may make.
         *
         * A long story does not fit one request - 525 messages of a real chat are
         * 426,000 characters - so it is read in several, and the findings pooled.
         *
         * 0 means as many as the history needs. A number caps what one scan may cost,
         * at the price of leaving the oldest messages unread.
         */
        scanMaxChunks: 0,
        /**
         * Connection for a scan. Empty means the extraction connection.
         *
         * A scan is a harder job than a per-message update - the whole history, every
         * character, in one reply - so the model that handles updates fine may not cope.
         * Scans are rare, which makes a stronger model affordable here and not there.
         */
        scanProfileId: '',
        /**
         * Send a JSON schema with the extraction request.
         *
         * Off by default because it is actively harmful on some backends: a Gemini
         * profile returns an empty object for a schema it will not accept, and its
         * supported subset rejects property names containing spaces, slashes or
         * colons - which real stat names routinely have ("Willpower / Focus").
         * The system prompt pins the shape reliably on every backend without it.
         */
        extractionUseSchema: false,
        /**
         * Ask the reader to say why it changed each value.
         *
         * The reply says what it wants changed and never why, so a stat that moves for no
         * reason anyone can see is indistinguishable from one that moved for a good one.
         * The reasons are shown on the review rows rather than written into the chat:
         * anything put in a message becomes part of the next turn's prompt, and the model
         * would start reading its own past justifications as story.
         *
         * Off by default: a small reader should focus on the update. Turn this on when
         * review rows need the model's evidence alongside the proposed value.
         */
        extractionReasons: false,
        /**
         * Remove the tracker's own status block from a message once it has been read.
         *
         * Left in, every block is saved to the chat file and re-sent on every later
         * turn - 71% of one real 317-message transcript - and teaches the model to keep
         * emitting them. The removed text is preserved on message.extra, which is not
         * part of the prompt.
         */
        stripStatusFromHistory: true,
        /** How many messages from the end the read-only scene block is inserted. */
        sceneInjectionDepth: 1,
        hudEnabled: true,
        hudPosition: 'top-right',
        hudScale: 1.0,
    /**
     * How the whole HUD is laid out. One of HUD_LAYOUTS in constants.js.
     *
     * Replaced hudMeterStyle, which offered bar, segmented, rings and text. The frame and
     * the meter were never independent choices - see the note on HUD_LAYOUTS - so this is
     * one setting where there were two, and old values migrate to their nearest layout.
     */
    hudLayout: 'plate',
    /** Width of a bar or segmented meter, in pixels. */
    hudMeterWidth: 92,
    /** Height of a bar or segmented meter, in pixels. */
    hudMeterHeight: 14,
    /**
     * Ring thickness in pixels, the ring equivalent of a bar's width.
     *
     * Its own setting rather than reusing hudMeterWidth: that runs 60-260px, which is a
     * sensible bar but an absurd ring, and one control meaning two different things in
     * two different ranges is worse than two controls.
     */
    hudRingThickness: 5,
    /**
     * Which side the portrait sits on: 'auto' follows the corner the HUD is docked to,
     * which is what it always did implicitly.
     */
    hudPortraitSide: 'auto',
    /** 'circle' or 'square'. */
    hudPortraitShape: 'circle',
    /** Empty means the theme's accent, which is what the border has always used. */
    hudPortraitBorder: '',
        hud: {
            position: { x: null, y: null },
        },
        presets: {},
        /**
         * Structure only. Fields render from the field list, in the order the builder
         * shows them, so nothing here names one - a name typed into a template cannot
         * follow the field when it is renamed, and captioning a value in two places is
         * what made a tracker read HP while every other screen read Health.
         *
         * {{globals}}, {{player}} and {{fields}} say where each set goes. A template with none
         * still gets them, appended, which is what every template written before this
         * one will do.
         */
        template: `<div class="sillynpc-status-box">
    <div class="sillynpc-status-header">{{globals}}</div>
    <div class="sillynpc-status-divider"></div>
    <div class="sillynpc-status-player">{{player}}</div>
    <div class="sillynpc-status-characters">
        {{#characters}}
        <div class="sillynpc-status-char">👤 {{name}} — {{fields}}</div>
        {{/characters}}
    </div>
</div>`,
        customCSS: '',
        renderPosition: 'bottom', // 'top' or 'bottom' of message
};
