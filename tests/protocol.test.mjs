import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMANDS,
  KEY_NAMES,
  MIN_NOTIFY_LENGTH,
  buildCommand,
  commandEqualsSourceDefault,
  exactCommandBytes,
  matchChord,
  parseHex,
  parseNotification,
  toHex,
} from '../js/protocol.js';

function packet(overrides = {}) {
  const d = [0, 0, 0, 0, 0, 0, 0, 120, 0, 50, 50];
  for (const [k, v] of Object.entries(overrides)) d[Number(k)] = v;
  return Uint8Array.from(d);
}

test('exact command bytes match uni_bt_le.c decimals', () => {
  assert.deepEqual(Array.from(exactCommandBytes('chord_mappings')), [
    177, 30, 31, 21, 0, 128, 147, 117, 5, 85, 81, 113, 160, 145, 112, 0, 80, 33,
    65, 176, 144, 112, 0, 48, 32, 64,
  ]);
  assert.equal(COMMANDS.chord_mappings.bytes.length, 26);
  assert.deepEqual(Array.from(exactCommandBytes('set_key')), [177, 30, 24, 1, 0, 0]);
  assert.deepEqual(Array.from(exactCommandBytes('set_chord')), [177, 30, 22, 5, 0, 0, 4, 12, 1, 1]);
  assert.deepEqual(Array.from(exactCommandBytes('set_drum')), [177, 30, 23, 5, 0, 46, 24, 0, 1, 1]);
  assert.deepEqual(Array.from(exactCommandBytes('set_chord_type')), [177, 30, 27, 2, 0, 5, 0]);
  assert.deepEqual(Array.from(exactCommandBytes('chord_tip')), [177, 30, 12, 3, 0, 2, 2, 1]);
  assert.deepEqual(Array.from(exactCommandBytes('chord_preview')), [177, 30, 37, 1, 0, 1]);
  assert.deepEqual(Array.from(exactCommandBytes('drum_preview')), [177, 30, 38, 1, 0, 1]);
  assert.equal(toHex(exactCommandBytes('set_key')), 'B1 1E 18 01 00 00');
  assert.equal(toHex(exactCommandBytes('chord_mappings')),
    'B1 1E 1F 15 00 80 93 75 05 55 51 71 A0 91 70 00 50 21 41 B0 90 70 00 30 20 40');
});

test('buildCommand defaults equal source and only overrides named indices', () => {
  const same = buildCommand('set_key', {});
  assert.ok(commandEqualsSourceDefault('set_key', same));
  const changed = buildCommand('set_key', { value: 4 });
  assert.equal(toHex(changed), 'B1 1E 18 01 00 04');
  assert.equal(changed[5], 4);
  assert.throws(() => buildCommand('set_key', { value: 256 }));
  assert.throws(() => buildCommand('nope'));
  const chord = buildCommand('set_chord', { group: 9, item: 1 });
  assert.deepEqual(Array.from(chord), [177, 30, 22, 5, 0, 0, 9, 1, 1, 1]);
});

test('parseHex accepts spaced, prefixed, and compact forms', () => {
  assert.deepEqual(Array.from(parseHex('B1 1E 18 01 00 00')), [177, 30, 24, 1, 0, 0]);
  assert.deepEqual(Array.from(parseHex('b11e18010000')), [177, 30, 24, 1, 0, 0]);
  assert.deepEqual(Array.from(parseHex('0xB1, 0x1E, 0x18, 0x01, 0x00, 0x00')), [177, 30, 24, 1, 0, 0]);
  assert.throws(() => parseHex('B1 1'));
  assert.throws(() => parseHex(''));
});

test('notification key 0–6 maps to C–B', () => {
  for (const [i, name] of Object.entries(KEY_NAMES)) {
    const p = parseNotification(packet({ 1: Number(i) }));
    assert.equal(p.keyName, name);
    assert.equal(p.configMode, false);
  }
});

test('config mode when byte[1] >= 16 and paddle neutral', () => {
  const p = parseNotification(packet({ 1: 16, 4: 2, 5: 0 }));
  assert.equal(p.configMode, true);
  assert.equal(p.configByte4, 2);
  const off = parseNotification(packet({ 1: 16, 5: 12 }));
  assert.equal(off.configMode, false);
});

test('chord rules follow source if/else order', () => {
  const cases = [
    [{ 4: 2 }, '7b'],
    [{ 2: 8 }, '7'],
    [{ 3: 4 }, '5b'],
    [{ 4: 4 }, '6m'],
    [{ 2: 16 }, '6'],
    [{ 3: 8 }, '6'],
    [{ 4: 8 }, '5'],
    [{ 2: 32 }, '5sus'],
    [{ 3: 16 }, '5/7'],
    [{ 4: 16 }, '1'],
    [{ 2: 64 }, '1sus'],
    [{ 3: 32 }, '1/3'],
    [{ 4: 32 }, '4'],
    [{ 2: 128 }, '3b'],
    [{ 3: 64 }, '4/6'],
    [{ 4: 64 }, '2m'],
    [{ 3: 1 }, '2'],
    [{ 3: 128 }, '4m'],
    [{ 4: 128 }, '3m'],
    [{ 3: 2 }, '3'],
    [{ 4: 1 }, '5m'],
  ];
  for (const [over, id] of cases) {
    const p = parseNotification(packet(over));
    assert.equal(p.chord?.id, id, `expected ${id} for ${JSON.stringify(over)}`);
  }
  // first-match: byte[4]==2 wins over other bits
  assert.equal(matchChord(packet({ 4: 2, 2: 8 }))?.id, '7b');
});

test('play mode when paddle byte is 64 skips chord match', () => {
  const p = parseNotification(packet({ 5: 64, 4: 8 }));
  assert.equal(p.chord, null);
  assert.equal(p.playMode, '根音上下');
  assert.equal(p.paddleLabel, '演奏模式選擇');
});

test('paddle A/B directions and velocity match source thresholds', () => {
  const up = parseNotification(packet({ 5: 12, 9: 20 }));
  assert.equal(up.paddleLabel, '撥片 A');
  assert.equal(up.paddleADirection, 'up');
  assert.equal(up.paddleAVelocity, (50 - 20) / 50);

  const down = parseNotification(packet({ 5: 3, 10: 80 }));
  assert.equal(down.paddleLabel, '撥片 B');
  assert.equal(down.paddleBDirection, 'down');
  assert.equal(down.paddleBVelocity, 80 / 50);

  const both = parseNotification(packet({ 5: 15, 9: 50, 10: 50 }));
  assert.equal(both.paddleLabel, '撥片 A+B');
  assert.equal(both.paddleADirection, 'center');
  assert.equal(both.paddleBDirection, 'center');
});

test('tempo is byte[7]; short packets are marked incomplete', () => {
  const p = parseNotification(packet({ 7: 96, 1: 4, 4: 16 }));
  assert.equal(p.tempo, 96);
  assert.equal(p.keyName, 'G');
  assert.equal(p.chord?.label, '1');
  assert.equal(p.incomplete, false);
  const short = parseNotification(Uint8Array.from([1, 2, 3]));
  assert.equal(short.incomplete, true);
  assert.ok(short.length < MIN_NOTIFY_LENGTH);
});
