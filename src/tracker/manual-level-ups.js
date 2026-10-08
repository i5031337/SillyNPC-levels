import { getContext } from '../../../../../st-context.js';
import { getSettings } from '../core/settings.js';
import { getAllCharacters } from '../characters/character-repository.js';
import { loadStateFromMetadata, applyUpdate, getCurrentPersonaKey } from './status-logic.js';
import { buildUpdateFromChanges } from './status-diff.js';
import { createManualLevelUpService } from './manual-level-up-logic.js';

export const manualLevelUps = createManualLevelUpService({ getContext, getSettings,
    getCards: getAllCharacters, loadState: loadStateFromMetadata, applyUpdate,
    getPersonaId: getCurrentPersonaKey, buildUpdate: buildUpdateFromChanges,
    newId: () => crypto.randomUUID(), save: () => getContext()?.saveMetadataDebounced?.() });
