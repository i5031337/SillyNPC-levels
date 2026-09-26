export const defaultTrackerSettings = {
        enabled: true,
        showOnlyAtBottom: false,
        globalStats: [
            { name: 'Location', defaultValue: 'Unknown', format: '<b>{{name}}:</b> {{value}}', visible: true },
            { name: 'Time', defaultValue: 'Morning', format: '<b>{{name}}:</b> {{value}}', visible: true },
            { name: 'Quest', defaultValue: 'None', format: '<b>{{name}}:</b> {{value}}', visible: true }
        ],
        showGlobalStats: true,
        npcStats: [
            { name: 'HP', defaultValue: '10/10', format: '{{name}}: {{value}}', maxStatValue: '10', visible: true, persistence: 'variable' },
            { name: 'Energy', defaultValue: '5/5', format: '{{name}}: {{value}}', maxStatValue: '5', visible: true, persistence: 'variable' },
            { name: 'Condition', defaultValue: 'Healthy', format: '{{value}}', maxStatValue: '', visible: true, persistence: 'variable' }
        ],
        playerStats: [
            { name: 'HP', defaultValue: '20/20', format: '{{name}}: {{value}}', maxStatValue: '20', visible: true, isPrimary: true, color: '#e03131' },
            { name: 'Energy', defaultValue: '10/10', format: '{{name}}: {{value}}', maxStatValue: '10', visible: true, isPrimary: true, color: '#3b5bdb' },
            { name: 'Level', defaultValue: '1', format: '{{name}}: {{value}}', maxStatValue: '', visible: true, isPrimary: false },
            { name: 'XP', defaultValue: '0/100', format: '{{name}}: {{value}}', maxStatValue: '100', visible: true, isPrimary: false },
            { name: 'Level Bonus', defaultValue: '', format: '{{name}}: {{value}}', maxStatValue: '', visible: true, isPrimary: false }
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
                target: 'all' // 'player', 'npc', or 'all'
            }
        ],
        summaryThreshold: 5,
        /**
         * How many undo steps to keep per chat. Was a hardcoded 2, then 10.
         *
         * Ten was already thin, and while scene presence was recording steps it was worse
         * than thin: ten of those went by in four seconds during a chat load and took the
         * only remaining copy of a story's stats with them. Presence no longer records, so
         * these are all real changes now - and reaching back a couple of dozen of them is
         * a handful of messages rather than a handful of seconds.
         */
        historyDepth: 25,
        /** Show each NPC's card portrait in the tracker box. */
        showNpcPortraits: true,
        /** The characters in equal columns across the box rather than one per line. */
        characterColumns: false,
        /**
         * Who decides which characters are in the scene.
         * 'speakers' - derived from who actually appears in the message (deterministic)
         * 'ai'       - the model's characters array, the original behaviour
         */
        castMode: 'speakers',
        /** Messages a character may go unseen before leaving the scene. */
        castGraceMessages: 3,
        /**
         * How the tracker learns what changed.
         * 'extract' - a separate request reads the finished message and returns JSON.
         *             The narrative prompt then carries no tracker instructions, so a
         *             character card that forbids status output stops conflicting.
         * 'inline'  - the original behaviour: ask for a <status_update> block in the
         *             same response as the narrative.
         */
        extractionMode: 'extract',
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
        reviewMode: 'risky',
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
        /**
         * Record what each message changed, so the box under an older message can show
         * the numbers of that moment instead of today's.
         *
         * Kept on message.extra, which is never read back into the prompt, so this costs
         * nothing in tokens - only a few hundred bytes per message in the chat file.
         */
        recordMessageHistory: true,
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
         * Which world stat is the clock. The narrator already keeps one - the tracker
         * simply never read it.
         */
        clockStat: 'Time',
        /**
         * Most a single message may pay out, in minutes.
         *
         * A misread timestamp or a wild time skip would otherwise refill or drain
         * everything at once. A day is generous for a normal turn and still bounds the
         * damage; the limit is named in the change record when it bites.
         */
        clockMaxElapsedMinutes: 1440,
        /**
         * What elapsed time does on its own.
         *
         * { id, enabled, scope: 'player'|'characters'|'global', stat,
         *   amount, perMinutes, conditionStat, conditionValue }
         *
         * Arithmetic, not a reading of the prose, so it applies without review and is
         * recorded like any other change.
         */
        timeRules: [],
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
         * On by default, and a setting because it costs tokens and a weak extraction model
         * can lose JSON quality when asked for prose alongside it.
         */
        extractionReasons: true,
        /**
         * Things said and done that are not finished with: promises, threats, debts,
         * secrets, deadlines, plans.
         *
         * Off by default. It adds to the extraction prompt on every message, and a reader
         * that over-reports turns eight useful lines into fifty - so it is opt-in until
         * you have looked at what it catches on your own chat.
         */
        threadsEnabled: false,
        /**
         * How many open threads ride along in the scene block - the "active" ones.
         *
         * Highest scoring rather than oldest: see threadScore in threads.js for why
         * ordering by age alone picked badly at both ends of the list.
         */
        threadsInjectedMax: 8,
        /**
         * How many open threads are kept at all. Past this the lowest scoring is deleted.
         *
         * The reason there is a cap: nothing ever removed a thread, so a long chat reached
         * eighty of them. Only the active handful were ever sent to the story, but every
         * one of them was pasted into the extraction prompt on every message, so the pile
         * cost more the bigger it got. Pinned threads do not count against this.
         */
        threadsOpenMax: 20,
        /** How many settled threads stay as a record. Oldest deleted past this. */
        threadsClosedKeep: 10,
        /**
         * Messages until a thread is worth half its kind's weight.
         *
         * Ageing is in messages, not time: a story left for a week and picked up where it
         * stopped has not moved on, and one played hard for an hour has.
         */
        threadsHalfLife: 60,
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
     * Minutes between automatic system checkpoints. 0 turns them off.
     *
     * A system's snapshot is otherwise only rewritten when you switch away from it,
     * so a system you never leave keeps whatever it held the last time you did.
     */
    /**
     * Replaces the built-in extraction instructions when set. Empty uses the built-in.
     *
     * Stored empty rather than seeded with the text: the built-in runs to a couple of
     * kilobytes, it changes between versions, and a copy in everyone's settings would
     * freeze whatever shipped the day they installed it. Restore recommended fills the
     * box with the current one to edit.
     *
     * The collection schema and the worked example are appended to the *user* message,
     * not to this, so rewriting these instructions cannot delete the field list the
     * reply depends on.
     */
    extractionPrompt: '',
    systemAutoSaveMinutes: 0,
    /**
     * How many checkpoints to keep per system.
     *
     * Each holds a full copy of the world and the configuration, so this is a real
     * cost in settings.json - a world with inline images can be hundreds of KB.
     */
    systemCheckpointsKept: 5,
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
        systemRules: 'Update stats realistically based on events. HP and Energy should change according to combat or resting. Location and Time should progress logically. Avoid double-deducting spell or skill costs that were already paid in previous turns.',
        sceneBindingStat: '',
        renderPosition: 'bottom', // 'top' or 'bottom' of message
};
