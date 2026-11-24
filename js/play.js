import { barAtBeat, scoreBars, totalDurationMs } from './charts.js';

export function createPlayer(chart, { onFrame, onEnd } = {}) {
  const events = [];
  let startedAt = 0;
  let resumeOffset = 0;
  let running = false;
  let raf = 0;
  let finished = false;

  function now() {
    return performance.now();
  }

  function elapsedMs() {
    if (running) return now() - startedAt;
    return resumeOffset;
  }

  function frame() {
    if (!running) return;
    const elapsed = elapsedMs();
    const beat = elapsed / (60_000 / chart.bpm);
    const pos = barAtBeat(chart, beat);
    onFrame?.({
      elapsed,
      beat,
      duration: totalDurationMs(chart),
      ...pos,
    });
    if (pos.finished) {
      finished = true;
      running = false;
      resumeOffset = totalDurationMs(chart);
      onEnd?.(score());
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (finished) reset();
    startedAt = now() - resumeOffset;
    running = true;
    finished = false;
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    if (!running) return;
    resumeOffset = elapsedMs();
    running = false;
    cancelAnimationFrame(raf);
  }

  function reset() {
    running = false;
    finished = false;
    resumeOffset = 0;
    startedAt = 0;
    events.length = 0;
    cancelAnimationFrame(raf);
    onFrame?.({
      elapsed: 0,
      beat: 0,
      duration: totalDurationMs(chart),
      ...barAtBeat(chart, 0),
    });
  }

  function addEvent(chord, t = now()) {
    if (!chord) return;
    events.push({ t, chord, offset: t - (running ? startedAt : startedAt || t) });
  }

  function score() {
    const start = startedAt || now();
    // Events are stored with absolute performance.now(); scoreBars expects that.
    return scoreBars(chart, events, start);
  }

  return {
    start,
    pause,
    reset,
    addEvent,
    score,
    events,
    isRunning: () => running,
    isFinished: () => finished,
    elapsedMs,
  };
}
