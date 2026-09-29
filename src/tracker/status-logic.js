// Public status API. Implementation is grouped by responsibility in status-*.js.
import { bind as bind_stat_values } from './status-stat-values.js';
import { bind as bind_persona_state } from './status-persona-state.js';
import { bind as bind_chat_session } from './status-chat-session.js';
import { bind as bind_state_storage } from './status-state-storage.js';
import { bind as bind_status_summary } from './status-status-summary.js';
import { bind as bind_scene_prompt } from './status-scene-prompt.js';
import { bind as bind_update_parser } from './status-update-parser.js';
import { bind as bind_update_constraints } from './status-update-constraints.js';
import { bind as bind_apply_update } from './status-apply-update.js';
import { bind as bind_cast_decisions } from './status-cast-decisions.js';
import { bind as bind_scene_presence } from './status-scene-presence.js';
import { bind as bind_collection_updates } from './status-collection-updates.js';
import { bind as bind_collection_schema } from './status-collection-schema.js';
import { bind as bind_stat_schema } from './status-stat-schema.js';
import { bind as bind_system_presets } from './status-system-presets.js';
import { bind as bind_checkpoints } from './status-checkpoints.js';

// Bind every provider before callers use the shared API. Each provider registers
// named getters, so cross-module calls resolve after initialization completes.
const deps = {};
for (const bind of [
    bind_stat_values,
    bind_persona_state,
    bind_chat_session,
    bind_state_storage,
    bind_status_summary,
    bind_scene_prompt,
    bind_update_parser,
    bind_update_constraints,
    bind_apply_update,
    bind_cast_decisions,
    bind_scene_presence,
    bind_collection_updates,
    bind_collection_schema,
    bind_stat_schema,
    bind_system_presets,
    bind_checkpoints,
]) bind(deps);
Object.freeze(deps);

export const mergeStatValue = deps.mergeStatValue;
export const resolveMaxValue = deps.resolveMaxValue;
export const lockedStats = deps.lockedStats;
export const sanitizeModelUpdate = deps.sanitizeModelUpdate;
export const promptCeiling = deps.promptCeiling;
export const highestCeiling = deps.highestCeiling;
export const isNumericStat = deps.isNumericStat;
export const describeNpcStatFields = deps.describeNpcStatFields;
export const meterHasCeiling = deps.meterHasCeiling;
export const drawsMeter = deps.drawsMeter;
export const clampToCeiling = deps.clampToCeiling;
export const getInitialStatValue = deps.getInitialStatValue;
export const getCurrentPersonaKey = deps.getCurrentPersonaKey;
export const getPlayerCard = deps.getPlayerCard;
export const getPlayerImageUrl = deps.getPlayerImageUrl;
export const createChatPlayerSeed = deps.createChatPlayerSeed;
export const activatePersona = deps.activatePersona;
export const getPersonaData = deps.getPersonaData;
export const rememberSwipeBase = deps.rememberSwipeBase;
export const restoreProfiles = deps.restoreProfiles;
export const getSwipeBase = deps.getSwipeBase;
export const swipeBaseRecord = deps.swipeBaseRecord;
export const setSwipeBaseAligner = deps.setSwipeBaseAligner;
export const getProfileBase = deps.getProfileBase;
export const initStatusLogic = deps.initStatusLogic;
export const PERSONA_KEY = deps.PERSONA_KEY;
export const hasOpenChat = deps.hasOpenChat;
export const getChatPersona = deps.getChatPersona;
export const rememberChatPersona = deps.rememberChatPersona;
export const restoreChatPersona = deps.restoreChatPersona;
export const SYSTEM_KEY = deps.SYSTEM_KEY;
export const getChatSystem = deps.getChatSystem;
export const chatHasStarted = deps.chatHasStarted;
export const restoreChatSystem = deps.restoreChatSystem;
export const loadStateFromMetadata = deps.loadStateFromMetadata;
export const saveStateToMetadata = deps.saveStateToMetadata;
export const getHistoryEntries = deps.getHistoryEntries;
export const undoLastChange = deps.undoLastChange;
export const restoreHistoryEntry = deps.restoreHistoryEntry;
export const formatCompactStatus = deps.formatCompactStatus;
export const getStatusInstructions = deps.getStatusInstructions;
export const getStatusExample = deps.getStatusExample;
export const applyScenePrompt = deps.applyScenePrompt;
export const buildSceneContext = deps.buildSceneContext;
export const parseMessageForUpdates = deps.parseMessageForUpdates;
export const splitStatKeyPart = deps.splitStatKeyPart;
export const allowedValues = deps.allowedValues;
export const takeRefusedValues = deps.takeRefusedValues;
export const constrainToOptions = deps.constrainToOptions;
export const capToLength = deps.capToLength;
export const constrainToDefinition = deps.constrainToDefinition;
export const findMatchingStatKey = deps.findMatchingStatKey;
export const applyUpdate = deps.applyUpdate;
export const findCardForName = deps.findCardForName;
export const resolveCanonicalName = deps.resolveCanonicalName;
export const CAST_PERSONA = deps.CAST_PERSONA;
export const CAST_EXCLUDED = deps.CAST_EXCLUDED;
export const getCastDecisions = deps.getCastDecisions;
export const setCastDecision = deps.setCastDecision;
export const resolvePersonaSpeaker = deps.resolvePersonaSpeaker;
export const mayJoinScene = deps.mayJoinScene;
export const reconcileScenePresence = deps.reconcileScenePresence;
export const registerActiveCharacter = deps.registerActiveCharacter;
export const removeActiveCharacter = deps.removeActiveCharacter;
export const addItem = deps.addItem;
export const removeItem = deps.removeItem;
export const syncOverrideToActiveState = deps.syncOverrideToActiveState;
export const updateMasterItem = deps.updateMasterItem;
export const renameMasterItem = deps.renameMasterItem;
export const deleteMasterItem = deps.deleteMasterItem;
export const renameCollectionId = deps.renameCollectionId;
export const statsInSystem = deps.statsInSystem;
export const renameStat = deps.renameStat;
export const renameCollectionField = deps.renameCollectionField;
export const getActiveSystem = deps.getActiveSystem;
export const migrateToActiveSystem = deps.migrateToActiveSystem;
export const setActiveSystem = deps.setActiveSystem;
export const createSystem = deps.createSystem;
export const saveSystemPreset = deps.saveSystemPreset;
export const applySystemPreset = deps.applySystemPreset;
export const getCheckpoints = deps.getCheckpoints;
export const saveCheckpoint = deps.saveCheckpoint;
export const restoreCheckpoint = deps.restoreCheckpoint;
export const deleteCheckpoint = deps.deleteCheckpoint;
export const applyCheckpointSchedule = deps.applyCheckpointSchedule;
export const deleteSystemPreset = deps.deleteSystemPreset;
export const importSystemPreset = deps.importSystemPreset;
