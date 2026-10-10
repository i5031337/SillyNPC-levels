import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVoiceCues } from '../src/tts/voice-cue-format.js';

const line = '[[NPC_VOICE speaker="Mira" description="adult feminine voice, low and warm"]]';
const records = [{ speakerLabel: 'Mira', text: 'Wait.', isPersona: false }];

test('accepts only a complete first cue for a recognized NPC in the reply', () => {
    assert.deepEqual(parseVoiceCues(`${line}\n\nMira: "Wait."\n${line}`, records),
        [{ speaker: 'Mira', description: 'adult feminine voice, low and warm' }]);
    assert.deepEqual(parseVoiceCues(line, []), []);
    assert.deepEqual(parseVoiceCues(line, [{ ...records[0], isPersona: true }]), []);
    assert.deepEqual(parseVoiceCues(line.replace('Mira', 'Other'), records), []);
});

test('rejects malformed, fenced, and multiline cue text', () => {
    assert.deepEqual(parseVoiceCues(`\`\`\`text\n${line}\n\`\`\``, records), []);
    assert.deepEqual(parseVoiceCues(`Narration ${line}`, records), []);
    assert.deepEqual(parseVoiceCues(line.replace('voice, low', 'voice"\nmore, low'), records), []);
});
