import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_CHARTS,
  barAtBeat,
  colorForChord,
  normalizeChord,
  padForChord,
  parseChart,
  scoreBars,
  scoreLabel,
  totalDurationMs,
} from '../js/charts.js';

test('normalize and pad mapping for default C layout', () => {
  assert.equal(normalizeChord('[C]'), 'C');
  assert.equal(normalizeChord('C'), 'C');
  assert.equal(normalizeChord('am'), 'Am');
  assert.equal(normalizeChord('6m'), 'Am');
  assert.equal(padForChord('C').index, 1);
  assert.equal(padForChord('G').index, 5);
  assert.equal(padForChord('Am').index, 6);
  assert.equal(colorForChord('F'), '#3DDB7A');
});

test('parses bracket charts with headers and lyrics', () => {
  const chart = parseChart(`標題: 練習
調: C
速度: 80
每格拍數: 2

[C] 一二 [G] 三四
[Am] 五六 [F] 七八
`);
  assert.equal(chart.title, '練習');
  assert.equal(chart.bpm, 80);
  assert.equal(chart.bars.length, 4);
  assert.equal(chart.bars[0].chord, 'C');
  assert.equal(chart.bars[0].lyric, '一二');
  assert.equal(chart.bars[1].chord, 'G');
  assert.equal(chart.totalBeats, 8);
  assert.equal(totalDurationMs(chart), (60_000 / 80) * 8);
  const mid = barAtBeat(chart, 4.5);
  assert.equal(mid.bar.chord, 'Am');
  assert.equal(mid.finished, false);
  assert.equal(barAtBeat(chart, 99).finished, true);
});

test('parses a chord line followed by a lyric line', () => {
  const chart = parseChart(`[C] [G] [Am] [F]\n這 是 歌 詞`);
  assert.equal(chart.bars.map((b) => b.chord).join(' '), 'C G Am F');
  assert.equal(chart.bars[0].lyric, '這');
  assert.equal(chart.bars[3].lyric, '詞');
});

test('rejects empty or chordless text', () => {
  assert.throws(() => parseChart('   '));
  assert.throws(() => parseChart('只有文字沒有和弦'));
});

test('all demo charts parse and stay in C with public-domain notes', () => {
  for (const demo of DEMO_CHARTS) {
    const chart = parseChart(demo.text);
    assert.ok(chart.bars.length >= 8, demo.title);
    assert.equal(chart.key, 'C');
    assert.ok(demo.sourceNote.includes('公共領域'));
    assert.ok(!/生日快樂|Happy Birthday/i.test(demo.text));
  }
});

test('coarse scoring counts a chord that arrives in the bar window', () => {
  const chart = parseChart('速度: 60\n每格拍數: 2\n[C] [G] [C]');
  // 60 BPM, 2 beats = 2000ms per bar
  const startedAt = 10000;
  const events = [
    { t: 10100, chord: 'C' },
    { t: 12500, chord: 'G' },
    // third bar missed
  ];
  const score = scoreBars(chart, events, startedAt);
  assert.equal(score.total, 3);
  assert.equal(score.hits, 2);
  assert.equal(score.bars[2].hit, false);
  assert.equal(scoreLabel(0.95), '太棒了');
  assert.equal(scoreLabel(0.2), '再試一次');
});
