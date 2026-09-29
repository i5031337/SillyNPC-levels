import { defaultTrackerSettings } from './settings-tracker-defaults.js';
import { EXTENSION_VERSION, DEFAULT_PORTRAIT_SHAPE } from './constants.js';
import { DEFAULT_LORE_PROMPT } from '../prompts/default-prompt-texts.js';

export const defaultSettings = {
    version: EXTENSION_VERSION,
    enabled: true,
    applyColors: true,
    /**
     * Text size in the menus and sheets, and in the in-chat tracker box, as a multiplier
     * of whatever the chosen theme sets.
     *
     * Two rather than one because they are read in different places and at different
     * distances: the menu is a panel you are working in, and the box sits in the middle of
     * the story where it competes with the prose around it. Somebody who wants the tracker
     * out of the way usually does not want the settings shrunk with it.
     *
     * A multiplier rather than a size, so a theme that ships larger type - Fantasy HUD sets
     * 16px, Terminal 13px - stays proportionally itself.
     */
    menuFontScale: 1.0,
    trackerFontScale: 1.0,
    /* Declared here rather than created part-way through normalizeSettings, which is where
       these five used to appear as "if not set, set it". They worked, because every reader
       tolerates absence - but nothing that enumerates defaultSettings could see them, so
       export, import repair and any future reset-to-defaults all skipped them. That form
       additionally meant a legitimately falsy value could never be stored: harmless for
       five strings, and the wrong idiom to copy. */
    menuStyle: 'default',
    dividerStyle: 'subtle',
    avatarShape: 'rounded',
    avatarSize: 'medium',
    colorStyle: 'text',
    /* Which System Profile is in use, or '' for none. It was not in this file at all - it
       came into being the first time setActiveSystem wrote it - so the same enumeration
       problem applied, and reading the defaults gave no hint that the concept existed. */
    activeSystem: '',
    /**
     * Whether the story model is told how to lay dialogue out.
     *
     * On by default: everything this extension draws in the chat depends on the answer
     * having speaker lines in it, and until now that depended on the user having put a
     * formatting block in their persona.
     */
    dialogueFormatEnabled: true,
    /** Empty means the built-in text; the repair pass fills it in so the box is not blank. */
    dialogueFormatPrompt: '',
    /** 0 puts it after the newest message - the last thing read before answering. */
    dialogueFormatDepth: 0,
    /**
     * Whether this block appears in SillyTavern's own prompt list, to be ordered there.
     *
     * Off by default, and the default is not neutrality for its own sake: IN_CHAT at depth 0
     * puts the block after the newest message, and handing it to the list moves it up among
     * the system prompts until somebody sets In-Chat there. Changing where an existing user's
     * formatting rule sits, without being asked, is not a fix.
     */
    dialogueFormatInPromptList: false,
    /**
     * How the narrator should behave, injected late so a long chat cannot bury it.
     *
     * Off, and empty, by default. Unlike the dialogue format there is no built-in text to
     * fall back on: what a narrator should do is yours to say, and sending an opinion
     * nobody asked for into every message is not a sensible default.
     */
    narratorRulesEnabled: false,
    narratorRulesPrompt: '',
    narratorRulesDepth: 0,
    /** As above. The rules exist because a card's instructions sit too far from the reply. */
    narratorRulesInPromptList: false,
    /**
     * Phrases the model leans on, stopped at the sampler where the backend allows it.
     *
     * Travels with the system rather than staying global: what counts as slop is a
     * property of the fiction, and a horror world and a comedy one do not agree about it.
     */
    banListEnabled: false,
    banList: [],
    /** How far back the scan reads when it goes looking for them. */
    banScanDepth: 50,
    /** Colour a speaker who has no card, from their name. */
    autoColorUnknownSpeakers: true,
    /** Draw a portrait when automatic Fill creates an NPC without one. */
    autoPortraitOnFill: true,
    hideSpeakerNames: false,
    caseInsensitive: true,
    /**
     * Faces for speakers who have no card, or a card with no portrait.
     *
     * A list rather than the single defaultImage it replaces: one picture meant every
     * stranger in the story wore the same face. Each entry is { src, tags }, and the tags
     * are matched against the speaker's name so a guard draws from the guards.
     *
     * @type {Array<{ src: string, tags: string[] }>}
     */
    defaultImages: [],
    /**
     * How many messages a stranger can be absent before they are somebody else.
     *
     * The guard you speak to across three messages is one guard; the guard two hundred
     * messages later is a different person wearing the same word.
     */
    defaultPortraitRunGap: 12,
    /**
     * Whether the settings only worth touching for a reason are shown.
     *
     * Eighty-one settings is a lot to meet at once, and most of them are budgets and
     * limits whose defaults are right until something specific goes wrong. Hidden rather
     * than removed: every one of them still matters to somebody.
     */
    devMode: false,
    popupWidth: 80,
    popupHeight: 80,
    /** @type {'contain' | 'cover'} */
    defaultImageFit: 'contain',
    /**
     * Which part of a portrait the round frames keep.
     *
     * The HUD portrait and the tracker box's NPC portraits are circles filled with `cover`,
     * so a 2:3 image loses its top and bottom. Centred, that is the head. No single crop
     * suits every picture, so this is the choice - defaulting to the top, where a head is
     * in almost any portrait.
     *
     * @type {'top' | 'center' | 'bottom'}
     */
    portraitFraming: 'top',
    /**
     * Padding above and below a speech block, in pixels.
     *
     * Was a hardcoded 15, which on a block whose height is already set by the avatar read
     * as a band of empty colour rather than as breathing room. Horizontal padding is not
     * settable: text needs clearance from a coloured edge whatever this is.
     */
    speechPadY: 6,
    /** @type {string[]} */
    scanLorebooks: [],
    /** @type {string} */
    defaultLorebook: '',
    contextMessages: 15,
    /**
     * How much story text the lore writer may be shown, whatever the message count says.
     *
     * "Whole chat" meant literally the whole chat, and on a long story that is megabytes
     * in one prompt - the request could not be built at all. The newest messages are taken
     * up to this many characters and the rest dropped, so a long story degrades instead of
     * failing. Roughly ten thousand tokens: this is one request and cannot lean on the
     * several passes the history scan gets.
     */
    loreCharBudget: 40000,
    /**
     * Whether the lore writer may search your Data Bank before writing.
     *
     * Off by default: it needs Vector Storage set up with file indexing on, and does
     * nothing useful without it. SillyTavern's Vector Storage skips quiet prompts
     * outright ("Vectors: Skipping quiet prompt"), so lore generation has never seen the
     * Data Bank by accident - this asks for it deliberately, with /db-search.
     */
    loreUseDataBank: false,
    /**
     * Per-field wording for what Fill should write in each profile field.
     *
     * Sparse on purpose: only fields somebody has actually rewritten appear here, and
     * everything else reads the shipped hint. Storing all of them would freeze the set at
     * whatever shipped that day, so a field added later would never reach anybody who had
     * edited one - which is the state the extraction prompt is in.
     *
     * @type {Record<string, string>}
     */
    profileHints: {},
    /**
     * Your own wording for the texts the extension builds prompts from, by id - see
     * prompt-texts.js. Absent or empty means the built-in text, like profileHints.
     *
     * @type {Record<string, string>}
     */
    promptTexts: {},
    /**
     * Which connection writes lore. Empty means your main API.
     *
     * Its own setting rather than the tracker's: a small model chosen for returning JSON
     * is not who you want writing prose.
     */
    loreProfileId: '',
    /**
     * Prints one line per request - lore, extraction and portrait - naming the connection,
     * the model and the API key each one resolved to.
     *
     * Off by default because extraction runs after every message. It was previously
     * reachable only by typing SILLYNPC_DEBUG = true into DevTools, which is no use to
     * someone who does not already know it exists.
     */
    debugLogging: false,
    /**
     * Reply budget for lore generation.
     *
     * The combined named fields and lore sections need room for a complete reply.
     */
    loreMaxTokens: 1200,
    // What each generator has cost so far. Kept out of a System on purpose: a system is
    // a world and its rules, and rolling one back should not rewrite what you spent.
    usage: {},
    /** The editable lore template. Macros: {{name}}, {{facts}}, {{lore}}, {{context}}, {{world}}. */
    generationPrompt: DEFAULT_LORE_PROMPT,
    imgGenContextMessages: 10,
    /** Folder name under user/images/ for generated portraits. */
    imageSaveRoute: 'sillynpc',
    /**
     * Shape requested for generated portraits, a key of PORTRAIT_SHAPES.
     *
     * Overrides the host Image Generation resolution when a fixed shape is selected.
     */
    portraitShape: DEFAULT_PORTRAIT_SHAPE,
    personaData: {},
    master_items: {},
    /** Custom template; empty uses the maintained Image Generation template. */
    imgGenPrompt: '',
    imgGenNegativePrompt: 'speech bubbles, text, logo, watermark, username, signature, frames, panels, comic, multiple characters, crowd, busy background, character sheet, grid, reference sheet',
    /**
     * @type {{
     *   id: string,
     *   name: string,
     *   imageUrl: string,
     *   color: string,
     *   category: string,
     *   imageFit: '' | 'contain' | 'cover',
     *   aliases: { pattern: string, isRegex: boolean }[],
     *   lorebook: { world: string, uid: number } | null,
     * }[]}
     */
    characters: [],
    /**
     * The categories that exist, in the order they are shown.
     *
     * A register rather than something derived from the characters carrying a name. The
     * derived version could not be renamed - there was nothing to rename - and a category
     * ceased to exist the moment its last member left it, so one could not be made ahead
     * of the people going in it either.
     *
     * @type {string[]}
     */
    categories: [],
    /**
     * What a category used to be called, and what it is called now.
     *
     * A chat records which categories it is limited to, by name, in its own file - and
     * only the open one can be written to. Without this, renaming a category would leave
     * every other scoped chat asking for a name nobody carries, and its characters would
     * quietly drop out of it. Read by isCharacterInChat, so an old chat resolves itself
     * the next time it is opened.
     *
     * Kept one hop deep: renaming again rewrites whatever already pointed at the old name.
     *
     * @type {Record<string, string>}
     */
    categoryRenames: {},
    statusTracker: defaultTrackerSettings,
};
