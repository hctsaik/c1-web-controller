/**
 * LiberLive C1 unofficial BLE protocol helpers.
 *
 * Byte maps and command sequences are taken from the third-party
 * orinayo-pico source (uni_bt_le.c). They are NOT official LiberLive
 * documentation and have not been verified against a physical C1 here.
 *
 * Source: https://github.com/Jus-Be/orinayo-pico/blob/master/bluepad32/bt/uni_bt_le.c
 */

export const SERVICE_UUID = '000000ff-0000-1000-8000-00805f9b34fb';
export const CHARACTERISTIC_UUID = '0000ff03-0000-1000-8000-00805f9b34fb';

/** Standard Bluetooth services included so a GATT dump can list them if present. */
export const OPTIONAL_SERVICES = [
  SERVICE_UUID,
  '00001800-0000-1000-8000-00805f9b34fb', // Generic Access
  '00001801-0000-1000-8000-00805f9b34fb', // Generic Attribute
  '0000180a-0000-1000-8000-00805f9b34fb', // Device Information
  '0000180f-0000-1000-8000-00805f9b34fb', // Battery Service
  '03b80e5a-ede8-4b33-a751-6ce34ec4c700', // standard BLE-MIDI (C1 is not known to use this)
];

export const MIN_NOTIFY_LENGTH = 11;

/** Notification key index 0–6 as used in the LiberLive branch of uni_bt_le.c. */
export const KEY_NAMES = Object.freeze({
  0: 'C',
  1: 'D',
  2: 'E',
  3: 'F',
  4: 'G',
  5: 'A',
  6: 'B',
});

/**
 * Chord matchers, in the same if/else order as uni_bt_le.c.
 * Applied only when event_data[5] !== 64 (play-mode selection).
 */
export const CHORD_RULES = Object.freeze([
  { id: '7b', label: '7♭', test: (d) => d[4] === 2 },
  { id: '7', label: '7', test: (d) => d[2] === 8 },
  { id: '5b', label: '5♭', test: (d) => d[3] === 4 },
  { id: '6m', label: '6m', test: (d) => d[4] === 4 },
  { id: '6', label: '6', test: (d) => d[2] === 16 || d[3] === 8 },
  { id: '5', label: '5', test: (d) => d[4] === 8 },
  { id: '5sus', label: '5sus', test: (d) => d[2] === 32 },
  { id: '5/7', label: '5/7', test: (d) => d[3] === 16 },
  { id: '1', label: '1', test: (d) => d[4] === 16 },
  { id: '1sus', label: '1sus', test: (d) => d[2] === 64 },
  { id: '1/3', label: '1/3', test: (d) => d[3] === 32 },
  { id: '4', label: '4', test: (d) => d[4] === 32 },
  { id: '3b', label: '3♭', test: (d) => d[2] === 128 },
  { id: '4/6', label: '4/6', test: (d) => d[3] === 64 },
  { id: '2m', label: '2m', test: (d) => d[4] === 64 },
  { id: '2', label: '2', test: (d) => d[3] === 1 },
  { id: '4m', label: '4m', test: (d) => d[3] === 128 },
  { id: '3m', label: '3m', test: (d) => d[4] === 128 },
  { id: '3', label: '3', test: (d) => d[3] === 2 },
  { id: '5m', label: '5m', test: (d) => d[4] === 1 },
]);

/**
 * When event_data[5] === 64, event_data[4] selects a play mode.
 * Labels are the comments from uni_bt_le.c, not official C1 names.
 */
export const PLAY_MODE_BY_BYTE4 = Object.freeze({
  2: '全和弦上下',
  4: '和弦上、根音下',
  8: '根音上下',
  16: '三音上、根音下',
  32: '五音上、根音下',
  64: '下一個風格群組（來源會遞增）',
  128: '上一個風格群組（來源會遞減）',
});

/**
 * When event_data[1] >= 16 and paddle is neutral, byte[4] was used by
 * orinayo-pico to switch the author's own studio presets (Ketron, Ample
 * Guitar, etc.). Those names are NOT C1 features, so we only surface the
 * raw value.
 */
export const PADDLE_LABELS = Object.freeze({
  0: '中立',
  3: '撥片 B',
  12: '撥片 A',
  15: '撥片 A+B',
  64: '演奏模式選擇',
});

/** Exact sequences copied from uni_bt_le.c. Do not invent additional bytes. */
export const COMMANDS = Object.freeze({
  chord_mappings: Object.freeze({
    id: 'chord_mappings',
    nameZh: '寫入和弦對應',
    experimental: false,
    usedOnConnectInSource: true,
    bytes: Object.freeze([
      177, 30, 31, 21, 0, 128, 147, 117, 5, 85, 81, 113, 160, 145, 112, 0, 80, 33,
      65, 176, 144, 112, 0, 48, 32, 64,
    ]),
    note: '來源在連線成功、訂閱通知之後會寫入這 26 位元組。可能會改到琴上的和弦配置，請自行決定是否送出。',
  }),
  set_key: Object.freeze({
    id: 'set_key',
    nameZh: '設定調性',
    experimental: true,
    bytes: Object.freeze([177, 30, 24, 1, 0, 0]),
    note: '來源註解為 set_key，範例只有這一組位元組（最後一碼為 0）。欄位編碼未經官方證實。',
    fields: Object.freeze([
      {
        key: 'value',
        label: '數值（來源範例為 0）',
        index: 5,
        sourceDefault: 0,
      },
    ]),
  }),
  set_chord: Object.freeze({
    id: 'set_chord',
    nameZh: '設定和弦節奏',
    experimental: true,
    bytes: Object.freeze([177, 30, 22, 5, 0, 0, 4, 12, 1, 1]),
    note: '來源註解：chord paddle, group, item, key, difficulty。位元組布局是依這一則範例推論的。',
    fields: Object.freeze([
      { key: 'paddle', label: 'paddle', index: 5, sourceDefault: 0 },
      { key: 'group', label: 'group', index: 6, sourceDefault: 4 },
      { key: 'item', label: 'item', index: 7, sourceDefault: 12 },
      { key: 'key', label: 'key', index: 8, sourceDefault: 1 },
      { key: 'difficulty', label: 'difficulty', index: 9, sourceDefault: 1 },
    ]),
  }),
  set_drum: Object.freeze({
    id: 'set_drum',
    nameZh: '設定鼓組',
    experimental: true,
    bytes: Object.freeze([177, 30, 23, 5, 0, 46, 24, 0, 1, 1]),
    note: '來源註解：drum group, item, paddle, difficulty, auto-bass。位元組布局是依這一則範例推論的。',
    fields: Object.freeze([
      { key: 'group', label: 'group', index: 5, sourceDefault: 46 },
      { key: 'item', label: 'item', index: 6, sourceDefault: 24 },
      { key: 'paddle', label: 'paddle', index: 7, sourceDefault: 0 },
      { key: 'difficulty', label: 'difficulty', index: 8, sourceDefault: 1 },
      { key: 'autoBass', label: 'auto-bass', index: 9, sourceDefault: 1 },
    ]),
  }),
  set_chord_type: Object.freeze({
    id: 'set_chord_type',
    nameZh: '設定和弦類型',
    experimental: true,
    bytes: Object.freeze([177, 30, 27, 2, 0, 5, 0]),
    note: '來源註解為 set_chord_type，沒有說明各個欄位，因此只提供與來源完全相同的位元組。',
  }),
  chord_tip: Object.freeze({
    id: 'chord_tip',
    nameZh: '和弦提示',
    experimental: true,
    bytes: Object.freeze([177, 30, 12, 3, 0, 2, 2, 1]),
    note: '來源註解為 chord_tip，沒有說明各個欄位，因此只提供與來源完全相同的位元組。',
  }),
  chord_preview: Object.freeze({
    id: 'chord_preview',
    nameZh: '和弦預覽',
    experimental: true,
    bytes: Object.freeze([177, 30, 37, 1, 0, 1]),
    note: '來源註解為 chord_preview，只提供與來源完全相同的位元組。',
  }),
  drum_preview: Object.freeze({
    id: 'drum_preview',
    nameZh: '鼓組預覽',
    experimental: true,
    bytes: Object.freeze([177, 30, 38, 1, 0, 1]),
    note: '來源註解為 drum_preview，只提供與來源完全相同的位元組。',
  }),
});

export function toHex(bytes, sep = ' ') {
  return Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(sep);
}

export function parseHex(text) {
  if (typeof text !== 'string') throw new Error('請輸入十六進位字串');
  let s = text.trim();
  if (!s) throw new Error('沒有位元組可送出');
  s = s.replace(/0x/gi, '');
  s = s.replace(/[^0-9a-fA-F]/g, '');
  if (s.length === 0) throw new Error('沒有有效的十六進位數字');
  if (s.length % 2 !== 0) throw new Error('十六進位長度必須是偶數');
  const out = [];
  for (let i = 0; i < s.length; i += 2) {
    out.push(parseInt(s.slice(i, i + 2), 16));
  }
  return Uint8Array.from(out);
}

function at(d, i) {
  return i < d.length ? d[i] : null;
}

function paddleDirection(pos) {
  if (pos == null) return null;
  if (pos < 48) return 'up';
  if (pos > 58) return 'down';
  return 'center';
}

function paddleVelocity(pos, direction) {
  if (pos == null || direction === 'center' || direction == null) return null;
  if (direction === 'up') return (50 - pos) / 50;
  return pos / 50;
}

export function matchChord(bytes) {
  const d = Array.from(bytes);
  if (d.length < 5) return null;
  if (d[5] === 64) return null;
  for (const rule of CHORD_RULES) {
    if (rule.test(d)) return { id: rule.id, label: rule.label };
  }
  return null;
}

export function parseNotification(bytes) {
  const d = Array.from(bytes instanceof Uint8Array ? bytes : bytes || []);
  const b = (i) => at(d, i);
  const paddleRaw = b(5);
  const paddleA = b(9);
  const paddleB = b(10);
  const keyIndex = b(1);
  const parsed = {
    length: d.length,
    incomplete: d.length < MIN_NOTIFY_LENGTH,
    hex: toHex(d),
    bytes: d,
    byte0: b(0),
    keyIndex,
    keyName: keyIndex != null && KEY_NAMES[keyIndex] ? KEY_NAMES[keyIndex] : null,
    configMode: keyIndex != null && keyIndex >= 16 && paddleRaw === 0,
    bits2: b(2),
    bits3: b(3),
    bits4: b(4),
    paddleRaw,
    paddleLabel: paddleRaw != null && PADDLE_LABELS[paddleRaw] != null
      ? PADDLE_LABELS[paddleRaw]
      : paddleRaw == null
        ? null
        : `未對應（${paddleRaw}）`,
    byte6: b(6),
    tempo: b(7),
    byte8: b(8),
    paddleA,
    paddleB,
    extra: d.slice(11),
    chord: null,
    playMode: null,
    playModeRaw: null,
    configByte4: null,
    paddleADirection: null,
    paddleBDirection: null,
    paddleAVelocity: null,
    paddleBVelocity: null,
  };

  if (parsed.configMode) {
    parsed.configByte4 = b(4);
  }

  if (paddleRaw === 64) {
    parsed.playModeRaw = b(4);
    parsed.playMode = PLAY_MODE_BY_BYTE4[b(4)] || `未對應（byte[4]=${b(4)}）`;
  } else {
    parsed.chord = matchChord(d);
  }

  if (paddleRaw === 12 || paddleRaw === 15) {
    parsed.paddleADirection = paddleDirection(paddleA);
    parsed.paddleAVelocity = paddleVelocity(paddleA, parsed.paddleADirection);
  }
  if (paddleRaw === 3 || paddleRaw === 15) {
    parsed.paddleBDirection = paddleDirection(paddleB);
    parsed.paddleBVelocity = paddleVelocity(paddleB, parsed.paddleBDirection);
  }
  if (paddleRaw === 12) {
    parsed.paddleADirection = paddleDirection(paddleA);
    parsed.paddleAVelocity = paddleVelocity(paddleA, parsed.paddleADirection);
  }

  return parsed;
}

export function exactCommandBytes(id) {
  const cmd = COMMANDS[id];
  if (!cmd) throw new Error(`未知指令：${id}`);
  return Uint8Array.from(cmd.bytes);
}

/**
 * Rebuild a command from the source template, optionally replacing named
 * field bytes. Only indices that exist on the source example may be changed.
 * Unknown or out-of-range values throw; this never pads or invents a new frame.
 */
export function buildCommand(id, fieldOverrides = {}) {
  const cmd = COMMANDS[id];
  if (!cmd) throw new Error(`未知指令：${id}`);
  const bytes = Array.from(cmd.bytes);
  if (cmd.fields) {
    for (const field of cmd.fields) {
      if (!(field.key in fieldOverrides)) continue;
      const value = Number(fieldOverrides[field.key]);
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error(`${field.label} 必須是 0–255 的整數`);
      }
      bytes[field.index] = value;
    }
  }
  return Uint8Array.from(bytes);
}

export function commandEqualsSourceDefault(id, bytes) {
  const cmd = COMMANDS[id];
  if (!cmd) return false;
  const a = Array.from(bytes);
  const b = cmd.bytes;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export const ACTION_LIST = Object.freeze(
  Object.values(COMMANDS).map((c) => ({
    id: c.id,
    nameZh: c.nameZh,
    experimental: c.experimental,
  })),
);
