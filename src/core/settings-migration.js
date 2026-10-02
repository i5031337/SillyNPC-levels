import { debugLog, SPEAKER_PALETTE, NPC_LORE_FIELDS, normalizeHudLayoutId } from './constants.js';
import { paletteIndexFor } from './hash.js';
import { normaliseNpcPersistence } from '../tracker/stat-persistence.js';
import { normaliseStatUpdatePolicies } from '../tracker/stat-update-policy.js';
import { defaultSettings } from './settings-defaults.js';
import { saveSettings } from './settings.js';
import { migratePresetsAndStores } from './settings-store-migration.js';
import { normaliseBaseSettings } from './settings-base-migration.js';

/**
 * Is version a older than version b? Dotted numbers, missing parts count as zero.
 *
 * Anything unparsable answers false - "not older" - so a settings file with a version this
 * cannot read is left alone rather than migrated on a guess.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function versionBelow(a, b) {
    const parse = (v) => String(v ?? '').split('.').map(n => Number.parseInt(n, 10));
    const left = parse(a);
    const right = parse(b);
    if (left.some(Number.isNaN) || right.some(Number.isNaN)) return false;
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const l = left[i] ?? 0;
        const r = right[i] ?? 0;
        if (l !== r) return l < r;
    }
    return false;
}

/**
 * Were these settings last written before HUD and Tracker became two separate flags?
 *
 * 0.5.2 is where the split shipped, and it shipped the migration unguarded - so anyone who
 * has opened the extension since has already been through it. Running it again on them
 * would clear a HUD box they have ticked in the meantime, which is the bug this answers.
 *
 * settings.version still holds the version this file was last written under: normalizeSettings
 * stamps the current one at the end of its pass, well after this is read.
 *
 * @param {object} settings
 * @returns {boolean}
 */
function settingsPredateHudFlagSplit(settings) {
    return versionBelow(settings.version, '0.5.2');
}

/**
 * Brings a list of stat definitions up to the current shape.
 *
 * Type, and the lower bound, arrived when meters were introduced. hint and maxLength
 * joined them later, for the opposite kind of field: a free-text one had nothing said
 * about it at all, so the reader was shown a name and a long previous value and carried on
 * writing it. Both default to blank, which is no hint and no limit - what every field
 * already had.
 *
 * 'bar' becomes 'number'. The type used to name the drawing rather than the content, which
 * is why a field could be "a meter" while holding a date and why switching one back to Text
 * left the HUD still drawing a meter. What it always meant was "this holds a quantity";
 * whether a meter is drawn is now read from the value, where the ceiling is.
 *
 * Exported and called from two places, because a schema arrives by two doors: the settings
 * on load, and a saved system preset on switch. A migration that only covers one of them
 * silently misses every system somebody saved before it.
 *
 * @param {object[]} list Mutated in place. Missing or non-array is a no-op.
 */
export function normaliseStatDefs(list) {
    if (!Array.isArray(list)) return;
    for (const stat of list) {
        if (!stat) continue;
        stat.type = (stat.type === 'number' || stat.type === 'bar') ? 'number' : 'text';
        if (stat.type === 'number') stat.options = [];
        if (stat.min === undefined) stat.min = '';
        if (typeof stat.hint !== 'string') stat.hint = '';
        if (typeof stat.purpose !== 'string') stat.purpose = '';
        if (stat.maxLength === undefined) stat.maxLength = '';
    }
}

function normalizeCharactersAndCategories(settings) {
    debugLog('Processing characters');
    if (!Array.isArray(settings.characters)) settings.characters = [];
    for (const char of settings.characters) {
        if (!Array.isArray(char.aliases)) char.aliases = [];
        // Portraits predate the list. One rule covers both seeding it for a character
        // that never had one and adopting a portrait set outside it - and, because it
        // checks first, running twice does not duplicate.
        if (!Array.isArray(char.images)) char.images = [];
        if (char.imageUrl && !char.images.includes(char.imageUrl)) char.images.push(char.imageUrl);
        if (!('lorebook' in char)) char.lorebook = null;
        if (typeof char.color !== 'string') char.color = '';
        if (typeof char.category !== 'string') char.category = '';
        if (typeof char.imageFit !== 'string') char.imageFit = '';
        if (!char.statusOverrides || typeof char.statusOverrides !== 'object') char.statusOverrides = {};
        /* Which picture means which field value. Absent on every card until one is
           tagged, and deliberately not seeded to `{}` here - a card nobody has tagged
           should carry no key at all rather than an empty object per character. See
           image-tags.js, which creates it on the first write. */
        if ('imageTags' in char && (!char.imageTags || typeof char.imageTags !== 'object')) {
            delete char.imageTags;
        }
        /* Which folder their pictures are in. Absent until the first one is written for
           them, and never reset from the name afterwards - that is what stops a rename
           orphaning a library. See character-images.js. */
        if ('imageFolder' in char && typeof char.imageFolder !== 'string') {
            delete char.imageFolder;
        }
        // Field by field rather than whole-object, so a profile written before a field
        // existed gains the new one instead of being replaced by a blank set.
        if (!char.profile || typeof char.profile !== 'object') char.profile = {};
        for (const field of NPC_LORE_FIELDS) {
            if (typeof char.profile[field.id] !== 'string') char.profile[field.id] = '';
        }
        // Which profile fields Fill is allowed to write. Absent means none, which is the
        // default, so nothing existing needs migrating - only the shape is repaired.
        if (!Array.isArray(char.aiProfileFields)) char.aiProfileFields = [];
    }

    // The register, seeded from whoever is already carrying a category name. An existing
    // install opens with exactly the categories it had, in the order it showed them -
    // alphabetical - with nothing to set up. A name on a character that is missing from
    // the register is added rather than dropped, so a category cannot be lost to the two
    // falling out of step.
    if (!Array.isArray(settings.categories)) settings.categories = [];
    settings.categories = settings.categories.filter(c => typeof c === 'string' && c.trim());
    {
        const known = new Set(settings.categories);
        const strays = [...new Set(settings.characters
            .map(c => c.category)
            .filter(name => name && !known.has(name)))].sort();
        settings.categories.push(...strays);
    }
    if (!settings.categoryRenames || typeof settings.categoryRenames !== 'object'
        || Array.isArray(settings.categoryRenames)) {
        settings.categoryRenames = {};
    }

    // Cards used to be created with no accent colour and nothing ever filled one in, so
    // whether a speaker was coloured depended on having set it by hand. Existing cards are
    // given one now, skipping every shade already spoken for so nobody shares.
    {
        const taken = new Set(settings.characters
            .map(c => String(c.color || '').trim().toLowerCase()).filter(Boolean));
        for (const char of settings.characters) {
            if (String(char.color || '').trim()) continue;
            // Where paletteColorFor would put them, then the first free shade from there.
            const start = paletteIndexFor(char.name || '', SPEAKER_PALETTE.length);
            let chosen = SPEAKER_PALETTE[start];
            for (let i = 0; i < SPEAKER_PALETTE.length; i++) {
                const candidate = SPEAKER_PALETTE[(start + i) % SPEAKER_PALETTE.length];
                if (!taken.has(candidate.toLowerCase())) { chosen = candidate; break; }
            }
            char.color = chosen;
            taken.add(chosen.toLowerCase());
        }
    }

}

function normalizeDefaultImagesAndPreferences(settings) {
    // The fallback portrait was one picture; it is a pool now. Migrated rather than
    // dropped, and checked first so running twice does not add it again.
    //
    // Whatever it was stays as it was, data URI and all: turning one into a file on disk
    // needs a write, and this pass cannot wait for one. repairDefaultImages does that
    // afterwards.
    if (!Array.isArray(settings.defaultImages)) settings.defaultImages = [];
    if (typeof settings.defaultImage === 'string' && settings.defaultImage) {
        if (!settings.defaultImages.some(entry => entry?.src === settings.defaultImage)) {
            settings.defaultImages.unshift({ src: settings.defaultImage, tags: [] });
        }
        delete settings.defaultImage;
    }
    settings.defaultImages = settings.defaultImages
        .filter(entry => entry && typeof entry.src === 'string' && entry.src)
        .map(entry => ({
            src: entry.src,
            tags: (Array.isArray(entry.tags) ? entry.tags : [])
                .map(tag => String(tag).trim()).filter(Boolean),
        }));


    if (typeof settings.speakerIgnoreList !== 'string') settings.speakerIgnoreList = '';
}

function migrateLegacyTrackerLayout(settings) {
    debugLog('Status tracker migration');

    // hudMeterStyle became hudLayout: the meter's shape and the frame's shape turned out
    // to be one decision rather than two. Each old value keeps whichever new layout draws
    // its meters the same way, so nobody's HUD changes shape without them asking.
    if (settings.statusTracker && settings.statusTracker.hudMeterStyle) {
        const toLayout = {
            bar: 'plate',            // a panel with plain bars, which is what it was
            segmented: 'pips',       // notches, under a new name
            ring: 'splitring',       // the only ring layout that survived the gallery
            text: 'underline',       // names and values, with a rule instead of a bar
        };
        if (!settings.statusTracker.hudLayout) {
            settings.statusTracker.hudLayout =
                toLayout[settings.statusTracker.hudMeterStyle] || 'plate';
        }
        delete settings.statusTracker.hudMeterStyle;
    }
    if (settings.statusTracker) {
        settings.statusTracker.hudLayout = normalizeHudLayoutId(settings.statusTracker.hudLayout);
    }

    // Schema Migration: Migrate old displayStyle to unified menuStyle
    if (settings.statusTracker && settings.statusTracker.displayStyle) {
        const legacyThemeMap = {
            'modern': 'modern-dark',
            'minimal': 'default',
            'compact': 'default'
        };
        let style = settings.statusTracker.displayStyle;
        if (legacyThemeMap[style]) {
            style = legacyThemeMap[style];
        }
        if (settings.menuStyle === 'default' && style !== 'default') {
            settings.menuStyle = style;
        }
        delete settings.statusTracker.displayStyle;
        saveSettings();
    }

}

function normalizeTrackerSchema(settings) {
    if (!settings.statusTracker) {
        settings.statusTracker = structuredClone(defaultSettings.statusTracker);
    } else {
        delete settings.statusTracker.castMode;
        delete settings.statusTracker.castGraceMessages;
        delete settings.statusTracker.sceneBindingStat;
        // Ensure all default status tracker settings exist
        for (const [key, value] of Object.entries(defaultSettings.statusTracker)) {
            if (settings.statusTracker[key] === undefined) {
                settings.statusTracker[key] = structuredClone(value);
            }
        }
        
        // The legacy characterStats name must be moved before normalising NPC policy.
        if (settings.statusTracker.characterStats && !settings.statusTracker.npcStats) {
            settings.statusTracker.npcStats = settings.statusTracker.characterStats;
            delete settings.statusTracker.characterStats;
        }
        for (const listName of ['globalStats', 'npcStats', 'playerStats']) {
            normaliseStatDefs(settings.statusTracker[listName]);
        }
        normaliseStatUpdatePolicies(settings.statusTracker);
        normaliseNpcPersistence(settings.statusTracker.npcStats);

        // The same field a stat has had all along, on a collection. A stat could say how it
        // should be written and a collection could not say what it holds - so "pictures"
        // reached the reader as the bare word, and the prompt had nothing to offer but
        // guidance about inventories. Blank until somebody writes one.
        for (const col of settings.statusTracker.collections || []) {
            if (col && typeof col.hint !== 'string') col.hint = '';
        }

        // Migrate stats to have visible property
        if (Array.isArray(settings.statusTracker.globalStats)) {
            for (const stat of settings.statusTracker.globalStats) {
                if (stat && stat.visible === undefined) stat.visible = true;
            }
        }
        
        if (Array.isArray(settings.statusTracker.npcStats)) {
            for (const stat of settings.statusTracker.npcStats) {
                if (stat && stat.visible === undefined) stat.visible = true;
            }
        }
        
        // Initialize playerStats and collections if they don't exist
        if (!settings.statusTracker.playerStats) {
            settings.statusTracker.playerStats = structuredClone(defaultSettings.statusTracker.playerStats);
        } else {
            if (settings.statusTracker.playerStats.some(stat => stat.name?.toLowerCase() === 'xp')
                && settings.statusTracker.playerStats.some(stat => stat.name?.toLowerCase() === 'level')
                && !settings.statusTracker.playerStats.some(stat => stat.name?.toLowerCase() === 'level bonus')) {
                settings.statusTracker.playerStats.push(structuredClone(
                    defaultSettings.statusTracker.playerStats.find(stat => stat.name === 'Level Bonus')));
            }
            // Ensure all player stats have format and maxStatValue
            for (const stat of settings.statusTracker.playerStats) {
                if (stat.format === undefined) stat.format = '{{value}}';
                if (stat.maxStatValue === undefined) stat.maxStatValue = '';
            }

            /* The two flags used to be one decision: the HUD drew a stat only when it was
               Primary AND visible, and visible did nothing at all on a stat that was not
               Primary. They are separate places now - HUD and Tracker - and the HUD no
               longer consults visible.

               So a stat that was Primary with visible off, which appeared nowhere, would
               start appearing on the HUD. Clearing Primary keeps it where it was.

               Once, and only for settings that predate the split. Everything else in this
               pass is idempotent by shape - it turns a string into an object, or fills a
               key that is absent - so running it on every load costs nothing. This one is
               not: Primary with Tracker off is a perfectly ordinary choice afterwards, and
               re-running turned it into a checkbox that would not stay ticked. Ticking HUD
               on a stat whose Tracker was off survived until the next reload, then cleared
               itself, which shipped in 0.5.2.

               The version stamp at the end of this pass is what makes it once: after any
               normalisation the stored version is the current one, so this never matches
               again. A separate "already done" marker was tried alongside it and removed -
               it could not fire in any case the version gate did not already cover, and a
               guard that cannot fail is a guard nothing tests. */
            if (settingsPredateHudFlagSplit(settings)) {
                for (const stat of settings.statusTracker.playerStats) {
                    if (stat.isPrimary && stat.visible === false) stat.isPrimary = false;
                }
            }
        }
        if (!settings.statusTracker.collections) {
            settings.statusTracker.collections = structuredClone(defaultSettings.statusTracker.collections);
        } else {
            // Migrate collections fields from strings to objects
            for (const col of settings.statusTracker.collections) {
                if (Array.isArray(col.fields) && col.fields.length > 0 && typeof col.fields[0] === 'string') {
                    debugLog(`Migrating collection "${col.id}" fields to object format.`);
                    col.fields = col.fields.map(fieldName => ({
                        name: fieldName,
                        type: fieldName === 'quantity' ? 'number' : 'text',
                        label: fieldName.charAt(0).toUpperCase() + fieldName.slice(1),
                        isMultiline: fieldName === 'description',
                        isPrimary: fieldName === 'name',
                        defaultValue: fieldName === 'quantity' ? '1' : ''
                    }));
                }
            }
        }
        if (!settings.statusTracker.hud) {
            settings.statusTracker.hud = structuredClone(defaultSettings.statusTracker.hud);
        }
    }

}

/**
 * Repairs settings on startup and after every import, even for current versions.
 * Imported character records can be missing fields that chat rendering requires.
 * @param {object} settings The live extension settings object.
 */
export function normalizeSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    delete settings.systemWorldArchive;
    const currentVersion = defaultSettings.version;

    normaliseBaseSettings(settings);
    normalizeCharactersAndCategories(settings);
    normalizeDefaultImagesAndPreferences(settings);
    migrateLegacyTrackerLayout(settings);
    normalizeTrackerSchema(settings);
    migratePresetsAndStores(settings, currentVersion);
}
