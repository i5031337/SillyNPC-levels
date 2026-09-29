import test from 'node:test';
import assert from 'node:assert/strict';
import { isImageOnlyMessage, trackerMessageIndex } from '../src/tracker/ui/status-ui-placement.js';

test('the tracker stays on visible prose after generated images', () => {
    const prose = { mes: 'A door opens.' };
    const image = { mes: 'A picture', extra: { inline_image: false, media: [{ url: 'image.png' }] } };
    assert.equal(isImageOnlyMessage(image), true);
    assert.equal(trackerMessageIndex([prose, image]), 0);
    assert.equal(trackerMessageIndex([prose, image, image]), 0);
    assert.equal(trackerMessageIndex([prose, image, { mes: 'The room beyond is dark.' }]), 2);
});

test('ordinary media and an empty chat keep their expected anchors', () => {
    assert.equal(trackerMessageIndex([]), -1);
    assert.equal(trackerMessageIndex([{ mes: 'Hello' }]), 0);
    assert.equal(trackerMessageIndex([{ extra: { inline_image: true, media: [{}] } }]), 0);
    assert.equal(trackerMessageIndex([{ extra: { inline_image: false, media: [{}] } }]), -1);
});
