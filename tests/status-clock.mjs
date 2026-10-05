import assert from 'node:assert/strict';
import test from 'node:test';
import { parseClock, elapsedMinutes } from '../src/tracker/status-clock.js';

test('story clocks accept numbered days and both clock conventions', () => {
    assert.deepEqual(parseClock('Day 3, 14:20'), { minutes: 2 * 1440 + 860, kind: 'day' });
    assert.deepEqual(parseClock('Day 1'), { minutes: 0, kind: 'day' });
    assert.deepEqual(parseClock('12:00 AM'), { minutes: 0, kind: 'time' });
    assert.deepEqual(parseClock('12 PM'), { minutes: 720, kind: 'time' });
    assert.deepEqual(parseClock('23:59'), { minutes: 1439, kind: 'time' });
});

test('invalid explicit times cannot become midnight or a fallback clock', () => {
    for (const clock of ['13:30 PM', '00:30 AM', '0 AM', '13 PM', '24:00', '12:60',
        'Day 0', 'Day 3, 13:30 PM', 'Day 3, 24:00', 'January 14 2012, 00:30 AM']) {
        assert.equal(parseClock(clock), null, clock);
    }
    assert.equal(elapsedMinutes(parseClock('Day 2, 23:00'), parseClock('Day 3, 24:00')), 0);
});

test('only bare times roll over at midnight; dated reversals and prose award no time', () => {
    assert.equal(elapsedMinutes(parseClock('23:30'), parseClock('00:15')), 45);
    assert.equal(elapsedMinutes(parseClock('Day 3, 14:00'), parseClock('Day 2, 14:00')), 0);
    assert.equal(elapsedMinutes(parseClock('14:00'), parseClock('Morning')), 0);
});
