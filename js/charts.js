/**
 * User-supplied chord charts, demo songs, and coarse bar scoring.
 * Demo melodies are public-domain; charts and (where used) lyrics are
 * written for this practice board. This module never loads official
 * LiberLive song data.
 */

export const PADS = Object.freeze([
  { index: 1, label: 'C', degree: '1', color: '#FF5B8A' },
  { index: 2, label: 'Dm', degree: '2m', color: '#FF8A3D' },
  { index: 3, label: 'Em', degree: '3m', color: '#FFD15A' },
  { index: 4, label: 'F', degree: '4', color: '#3DDB7A' },
  { index: 5, label: 'G', degree: '5', color: '#3D8CFF' },
  { index: 6, label: 'Am', degree: '6m', color: '#7B6CFF' },
  { index: 7, label: 'Bm', degree: '7m', color: '#C45BFF' },
]);

const ALIASES = {
  C: 'C', Cmaj: 'C', I: 'C', '1': 'C',
  Dm: 'Dm', Dmin: 'Dm', II: 'Dm', '2m': 'Dm',
  Em: 'Em', Emin: 'Em', III: 'Em', '3m': 'Em',
  F: 'F', Fmaj: 'F', IV: 'F', '4': 'F',
  G: 'G', Gmaj: 'G', V: 'G', '5': 'G',
  Am: 'Am', Amin: 'Am', VI: 'Am', '6m': 'Am',
  Bm: 'Bm', Bmin: 'Bm', VII: 'Bm', '7m': 'Bm',
  D: 'D', E: 'E', A: 'A', B: 'B',
  Fm: 'Fm', Gm: 'Gm', Cm: 'Cm',
  D7: 'D7', E7: 'E7', G7: 'G7', A7: 'A7', B7: 'B7', C7: 'C7', F7: 'F7',
};

const LETTER_TO_PAD = {
  C: 1, Dm: 2, Em: 3, F: 4, G: 5, Am: 6, Bm: 7,
};

export function normalizeChord(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  s = s.replace(/[\[\]（）()]/g, '');
  s = s.replace(/♭/g, 'b').replace(/♯/g, '#');
  s = s.replace(/\s+/g, '');
  if (!s) return null;
  const key = s[0].toUpperCase() + s.slice(1);
  return ALIASES[key] || ALIASES[s.toUpperCase()] || key;
}

export function padForChord(symbol) {
  const n = normalizeChord(symbol);
  if (!n) return null;
  if (LETTER_TO_PAD[n]) return PADS[LETTER_TO_PAD[n] - 1];
  // Fall back: major/minor of the same letter on the default C layout
  const letter = n[0];
  const map = { C: 1, D: 2, E: 3, F: 4, G: 5, A: 6, B: 7 };
  const idx = map[letter];
  return idx ? PADS[idx - 1] : null;
}

export function colorForChord(symbol) {
  return padForChord(symbol)?.color || '#FF6B6B';
}

function parseHeader(line, meta) {
  const m = line.match(/^(標題|歌名|title|調|调|key|速度|bpm|節拍|节拍|拍號|拍号|meter|每格拍數|每格拍数|beatsPerChord)\s*[:：]\s*(.+)$/i);
  if (!m) return false;
  const k = m[1].toLowerCase();
  const v = m[2].trim();
  if (['標題', '歌名', 'title'].includes(m[1]) || k === 'title') meta.title = v;
  else if (['調', '调', 'key'].includes(m[1]) || k === 'key') meta.key = v.replace(/調|调/g, '').trim() || 'C';
  else if (['速度', 'bpm'].includes(m[1]) || k === 'bpm') meta.bpm = Math.max(30, Math.min(240, Number(v) || 80));
  else if (['節拍', '节拍', '拍號', '拍号', 'meter'].includes(m[1]) || k === 'meter') meta.meter = v;
  else if (k.includes('beats') || m[1].includes('每格')) meta.beatsPerChord = Math.max(1, Number(v) || 2);
  return true;
}

function extractTokens(line) {
  const tokens = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let match;
  while ((match = re.exec(line))) {
    const before = line.slice(last, match.index).trim();
    if (before && tokens.length) tokens[tokens.length - 1].lyric += (tokens[tokens.length - 1].lyric ? ' ' : '') + before;
    const chord = normalizeChord(match[1]);
    if (chord) tokens.push({ chord, lyric: '' });
    last = re.lastIndex;
  }
  const after = line.slice(last).trim();
  if (after && tokens.length) tokens[tokens.length - 1].lyric += (tokens[tokens.length - 1].lyric ? ' ' : '') + after;
  return tokens;
}

export function parseChart(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('請貼上曲譜內容');
  }
  const meta = { title: '未命名曲譜', key: 'C', bpm: 80, meter: '4/4', beatsPerChord: 2 };
  const bars = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('//')) continue;
    if (parseHeader(raw, meta)) continue;
    if (/^[|｜\s]+$/.test(raw)) continue;
    const tokens = extractTokens(raw);
    if (tokens.length) {
      const next = (lines[i + 1] || '').trim();
      const nextIsLyric = next && !next.startsWith('#') && !/\[[^\]]+\]/.test(next) && !parseHeader(next, { ...meta });
      if (nextIsLyric && tokens.every((t) => !t.lyric)) {
        // Distribute a following lyric line across the chords
        const words = next.split(/\s+/);
        tokens.forEach((t, idx) => {
          t.lyric = words[idx] || (idx === 0 ? next : '');
        });
        i += 1;
      }
      tokens.forEach((t) => bars.push({ chord: t.chord, lyric: t.lyric || '', beats: meta.beatsPerChord }));
      continue;
    }
    // Lyric-only line attaches to the previous bar
    if (bars.length) bars[bars.length - 1].lyric = (bars[bars.length - 1].lyric + ' ' + raw).trim();
  }
  if (!bars.length) throw new Error('沒有找到和弦。請用 [C] [G] [Am] [F] 這樣的格式。');
  let beat = 0;
  const timed = bars.map((b) => {
    const item = { ...b, startBeat: beat, endBeat: beat + b.beats };
    beat += b.beats;
    return item;
  });
  const [num] = String(meta.meter).split('/').map(Number);
  const beatsPerBar = num || 4;
  return {
    title: meta.title,
    key: meta.key || 'C',
    bpm: meta.bpm,
    meter: meta.meter,
    beatsPerChord: meta.beatsPerChord,
    beatsPerBar,
    totalBeats: beat,
    bars: timed,
  };
}

export function barDurationMs(chart, bar) {
  return (60_000 / chart.bpm) * (bar.beats || chart.beatsPerChord || 2);
}

export function totalDurationMs(chart) {
  return (60_000 / chart.bpm) * chart.totalBeats;
}

export function barAtBeat(chart, beat) {
  if (beat < 0) return { index: 0, bar: chart.bars[0], progress: 0, finished: false };
  for (let i = 0; i < chart.bars.length; i++) {
    const b = chart.bars[i];
    if (beat < b.endBeat) {
      return { index: i, bar: b, progress: (beat - b.startBeat) / b.beats, finished: false };
    }
  }
  const last = chart.bars[chart.bars.length - 1];
  return { index: chart.bars.length - 1, bar: last, progress: 1, finished: true };
}

/**
 * Coarse scoring: a bar is a hit if a matching chord arrives within
 * the bar window, plus a generous grace on both sides.
 */
export function scoreBars(chart, events, startedAt) {
  const results = chart.bars.map((bar, index) => {
    const start = startedAt + (60_000 / chart.bpm) * bar.startBeat;
    const end = startedAt + (60_000 / chart.bpm) * bar.endBeat;
    const grace = (end - start) * 0.35;
    const windowStart = start - grace;
    const windowEnd = end + grace;
    const expected = normalizeChord(bar.chord);
    const hits = events.filter((ev) => {
      if (ev.t < windowStart || ev.t > windowEnd) return false;
      return normalizeChord(ev.chord) === expected;
    });
    return {
      index,
      chord: expected,
      lyric: bar.lyric,
      hit: hits.length > 0,
      hitAt: hits[0]?.t ?? null,
    };
  });
  const hits = results.filter((r) => r.hit).length;
  return {
    hits,
    total: results.length,
    ratio: results.length ? hits / results.length : 0,
    bars: results,
  };
}

export function scoreLabel(ratio) {
  if (ratio >= 0.9) return '太棒了';
  if (ratio >= 0.7) return '很好';
  if (ratio >= 0.4) return '加油';
  return '再試一次';
}


export function letterFromDegree(degreeId) {
  const map = {
    '1': 'C', '1sus': 'C', '1/3': 'C',
    '2': 'D', '2m': 'Dm',
    '3': 'E', '3m': 'Em', '3b': 'Eb',
    '4': 'F', '4m': 'Fm', '4/6': 'F',
    '5': 'G', '5m': 'Gm', '5b': 'Gb', '5sus': 'G', '5/7': 'G',
    '6': 'A', '6m': 'Am',
    '7': 'B', '7b': 'Bb', '7m': 'Bm',
  };
  return map[degreeId] || null;
}

export function packetForLabel(label, extra = {}) {
  const d = [
    0,
    extra.key ?? 0,
    0,
    0,
    0,
    extra.paddle ?? 0,
    0,
    extra.tempo ?? 80,
    0,
    extra.posA ?? 50,
    extra.posB ?? 50,
  ];
  const bit4 = { C: 16, Dm: 64, Em: 128, F: 32, G: 8, Am: 4 };
  const n = normalizeChord(label);
  if (bit4[n] != null) d[4] = bit4[n];
  else if (n === 'B' || n === 'Bm') d[2] = 8;
  return Uint8Array.from(d);
}

const STORAGE_KEY = 'c1-practice-board.charts.v1';

export const DEMO_CHARTS = Object.freeze([
  {
    id: 'demo-twinkle',
    title: '小星星',
    sourceNote: '公共領域旋律（傳統兒歌 Twinkle, Twinkle, Little Star）；英語歌詞為 Jane Taylor 1806 年詩作，屬公共領域。和弦為本練習板自行編寫。',
    text: `標題: 小星星
調: C
速度: 80
節拍: 4/4
每格拍數: 2

[C] Twinkle, twinkle [C] little star
[G] How I wonder [G] what you are
[Am] Up above the [Am] world so high
[G] Like a diamond [G] in the sky
[F] Twinkle, twinkle [F] little star
[C] How I wonder [C] what you are
[G] Up above the [G] world so high
[C] Like a diamond [C] in the sky
`,
  },
  {
    id: 'demo-tigers',
    title: '兩隻老虎',
    sourceNote: '公共領域旋律（Frère Jacques / 傳統兒歌）。中文唱詞為廣泛流傳的傳統版本。和弦為本練習板自行編寫。',
    text: `標題: 兩隻老虎
調: C
速度: 90
節拍: 4/4
每格拍數: 2

[C] 兩隻老虎 [C] 兩隻老虎
[G] 跑得快 [G] 跑得快
[C] 一隻沒有眼睛 [Am] 一隻沒有尾巴
[G] 真奇怪 [C] 真奇怪
`,
  },
  {
    id: 'demo-ode',
    title: '歡樂頌',
    sourceNote: '公共領域旋律（貝多芬《歡樂頌》主題）。本曲譜只放和弦，沒有使用受保護的現代歌詞。和弦為本練習板自行編寫。',
    text: `標題: 歡樂頌
調: C
速度: 88
節拍: 4/4
每格拍數: 2

[C] 第一句 [C] 第一句
[G] 第一句 [G] 第一句
[C] 第二句 [F] 第二句
[G] 第二句 [C] 第二句
[Am] 第三句 [F] 第三句
[C] 第三句 [G] 第三句
[F] 第四句 [C] 第四句
[G] 第四句 [C] 第四句
`,
  },
]);

export function loadUserCharts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveUserCharts(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function upsertUserChart(list, chart) {
  const item = {
    id: chart.id || `user-${Date.now()}`,
    title: chart.title,
    text: chart.text,
    sourceNote: chart.sourceNote || '我的自製曲譜',
    updatedAt: Date.now(),
  };
  const next = list.filter((c) => c.id !== item.id);
  next.unshift(item);
  return next;
}

export function allChartRecords(userList) {
  return [...DEMO_CHARTS, ...userList];
}
