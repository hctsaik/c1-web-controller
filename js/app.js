import {
  ACTION_LIST,
  CHARACTERISTIC_UUID,
  COMMANDS,
  SERVICE_UUID,
  buildCommand,
  commandEqualsSourceDefault,
  exactCommandBytes,
  parseHex,
  parseNotification,
  toHex,
} from './protocol.js';
import {
  bluetoothAvailable,
  dumpGatt,
  findPreferredCharacteristic,
  getCharacteristic,
  listPermittedDevices,
  requestC1Device,
  subscribe,
  writeBytes,
} from './ble.js';
import {
  describeMidiMessage,
  listInputs,
  loadMaps,
  mappingKeyFromMessage,
  midiAvailable,
  requestAccess,
  saveMaps,
  upsertMapping,
} from './midi.js';
import { MOCK_FIXTURES, createMockDevice } from './mock.js';
import {
  DEMO_CHARTS,
  PADS,
  colorForChord,
  letterFromDegree,
  loadUserCharts,
  packetForLabel,
  padForChord,
  parseChart,
  saveUserCharts,
  scoreLabel,
  upsertUserChart,
} from './charts.js';
import { createPlayer } from './play.js';

const MAX_LOG = 80;
const $ = (id) => document.getElementById(id);

const state = {
  mock: false,
  mockApi: null,
  device: null,
  server: null,
  characteristic: null,
  unsubscribe: null,
  dump: [],
  selected: null,
  reconnecting: false,
  midiAccess: null,
  midiMaps: loadMaps(),
  learning: false,
  userCharts: loadUserCharts(),
  view: 'songs',
  chartRecord: null,
  chart: null,
  player: null,
  targetChord: null,
  pressedLabel: null,
  lastParsed: null,
};

function isMockMode() {
  const q = new URLSearchParams(location.search);
  return q.get('mock') === '1' || q.get('mock') === 'true';
}

function nowTime() {
  return new Date().toLocaleTimeString('zh-Hant-TW', { hour12: false });
}

function setChip(el, text, kind) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-on', kind === 'on');
  el.classList.toggle('is-wait', kind === 'wait');
  el.classList.toggle('is-off', kind === 'off');
}

function setAllChips(text, kind) {
  setChip($('songs-conn'), text, kind);
  setChip($('play-conn'), text, kind);
  setChip($('pads-conn'), text, kind);
}

function setStatus(text) {
  $('connect-status').textContent = text || '';
}

function canWrite() {
  return !!state.characteristic;
}

function setWriteEnabled(on) {
  $('btn-cmd-chord_mappings').disabled = !on;
  document.querySelectorAll('.exp-form button[type="submit"]').forEach((b) => { b.disabled = !on; });
  document.querySelectorAll('[data-exact]').forEach((b) => { b.disabled = !on; });
  $('btn-hex-write').disabled = !on;
}

function showView(name) {
  state.view = name;
  const playish = name === 'play' || name === 'recap' || name === 'editor';
  document.body.classList.toggle('play-mode', playish);
  ['songs', 'editor', 'play', 'recap', 'pads', 'settings'].forEach((id) => {
    const el = $(`view-${id}`);
    if (el) el.hidden = id !== name;
  });
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('is-on', tab.dataset.view === name);
  });
  if (name !== 'play' && name !== 'recap' && state.player?.isRunning()) {
    state.player.pause();
    $('btn-play').textContent = '繼續彈唱';
  }
}

function formOverrides(form) {
  const out = {};
  form.querySelectorAll('input[name]').forEach((input) => {
    out[input.name] = Number(input.value);
  });
  return out;
}

function refreshPreviews() {
  for (const cmd of Object.values(COMMANDS)) {
    const note = document.querySelector(`[data-note="${cmd.id}"]`);
    if (note) note.textContent = cmd.note;
    const preview = document.querySelector(`[data-preview="${cmd.id}"]`);
    const form = document.querySelector(`form[data-command="${cmd.id}"]`);
    if (preview && form) {
      try {
        const bytes = buildCommand(cmd.id, formOverrides(form));
        const same = commandEqualsSourceDefault(cmd.id, bytes);
        preview.textContent = `${toHex(bytes)}${same ? '\n（與來源範例相同）' : '\n（已改動，與來源範例不同）'}`;
      } catch (err) {
        preview.textContent = err.message;
      }
    }
  }
  const mappingsNote = $('note-chord-mappings');
  if (mappingsNote) mappingsNote.textContent = `${COMMANDS.chord_mappings.note}\n${toHex(COMMANDS.chord_mappings.bytes)}`;
}

function prependLog(listEl, html, extraClass = '') {
  const li = document.createElement('li');
  if (extraClass) li.className = extraClass;
  li.innerHTML = html;
  listEl.prepend(li);
  while (listEl.children.length > MAX_LOG) listEl.lastChild.remove();
}

function chordFromParsed(parsed) {
  if (!parsed?.chord?.id) return null;
  const letter = letterFromDegree(parsed.chord.id) || parsed.chord.label;
  // Map to the default C-layout pad label so the seven physical buttons light up.
  return padForChord(letter)?.label || letter;
}

function onNotification(bytes) {
  const parsed = parseNotification(bytes);
  state.lastParsed = parsed;
  const hex = toHex(bytes);
  $('debug-hex').textContent = hex;
  $('pads-hex').textContent = hex;
  const chord = chordFromParsed(parsed);
  if (parsed.keyName) $('pads-key').textContent = parsed.keyName;
  if (parsed.tempo != null) $('pads-bpm').textContent = String(parsed.tempo);
  if (parsed.paddleLabel) $('pads-paddle').textContent = parsed.paddleLabel;
  if (chord) {
    state.pressedLabel = chord;
    if (state.player && (state.player.isRunning() || state.player.isFinished())) {
      state.player.addEvent(chord);
      refreshScore();
    }
  }
  updatePadHighlights();
  const summary = [
    parsed.keyName ? `調 ${parsed.keyName}` : '',
    parsed.chord ? `和弦 ${parsed.chord.label}` : '',
    parsed.paddleLabel || '',
    parsed.tempo != null ? `${parsed.tempo} BPM` : '',
  ].filter(Boolean).join(' · ');
  prependLog(
    $('notify-log'),
    `<time>${nowTime()}</time><span> ${hex}</span><div class="hint">${summary}</div>`,
  );
}

async function sendCommand(bytes, source) {
  if (!state.characteristic) {
    setStatus('尚未連到可寫入的特徵。');
    throw new Error('尚未連線');
  }
  try {
    const result = await writeBytes(state.characteristic, bytes);
    prependLog(
      $('write-log'),
      `<time>${nowTime()}</time><span class="log-ok">${result.hex}</span><div class="hint">${source} · ${result.method}</div>`,
      'log-ok',
    );
    setStatus(`已寫入：${source}`);
    return result;
  } catch (err) {
    prependLog(
      $('write-log'),
      `<time>${nowTime()}</time><span class="log-err">${toHex(bytes)}</span><div class="hint">${source} · 失敗：${err.message || err}</div>`,
      'log-err',
    );
    setStatus(`寫入失敗：${err.message || err}`);
    throw err;
  }
}

function propertyList(props) {
  return Object.entries(props).filter(([, v]) => v).map(([k]) => k).join(', ') || '（無屬性）';
}

function renderGatt(dump, preferred) {
  const root = $('gatt-dump');
  root.innerHTML = '';
  if (!dump || dump.length === 0) {
    root.textContent = '沒有讀到服務。';
    return;
  }
  const intro = document.createElement('p');
  intro.className = 'hint';
  intro.textContent = preferred
    ? '已自動選取非官方記載的服務 / 特徵並訂閱通知。'
    : '沒有找到非官方記載的服務 000000ff-… / 特徵 0000ff03-…。請從清單手動訂閱。';
  root.appendChild(intro);
  for (const service of dump) {
    const wrap = document.createElement('div');
    wrap.className = 'gatt-service';
    const title = document.createElement('h4');
    title.textContent = `${service.uuid}${service.uuid.toLowerCase() === SERVICE_UUID ? '  ← 非官方記載的 C1 服務' : ''}`;
    wrap.appendChild(title);
    if (service.error) {
      const err = document.createElement('p');
      err.className = 'hint';
      err.textContent = `讀特徵時發生錯誤：${service.error}`;
      wrap.appendChild(err);
    }
    for (const ch of service.characteristics || []) {
      const row = document.createElement('div');
      const isSel = state.selected
        && state.selected.serviceUuid.toLowerCase() === service.uuid.toLowerCase()
        && state.selected.charUuid.toLowerCase() === ch.uuid.toLowerCase();
      row.className = `char-row${isSel ? ' is-selected' : ''}`;
      const match = ch.uuid.toLowerCase() === CHARACTERISTIC_UUID && service.uuid.toLowerCase() === SERVICE_UUID;
      row.innerHTML = `<div class="char-meta">${ch.uuid}${match ? '  ← 非官方記載的特徵' : ''}<br>${propertyList(ch.properties)}${isSel ? '<br>目前寫入與通知的目標' : ''}</div>`;
      const actions = document.createElement('div');
      actions.className = 'btn-row';
      if (ch.properties.notify || ch.properties.indicate) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-quiet';
        b.textContent = '訂閱通知';
        b.addEventListener('click', () => selectCharacteristic(service.uuid, ch.uuid, { subscribe: true }));
        actions.appendChild(b);
      }
      if (ch.properties.write || ch.properties.writeWithoutResponse) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn-quiet';
        b.textContent = '設為寫入目標';
        b.addEventListener('click', () => selectCharacteristic(service.uuid, ch.uuid, { subscribe: false }));
        actions.appendChild(b);
      }
      row.appendChild(actions);
      wrap.appendChild(row);
    }
    root.appendChild(wrap);
  }
}

async function selectCharacteristic(serviceUuid, charUuid, { subscribe: doSub } = { subscribe: true }) {
  if (!state.server) return;
  if (state.unsubscribe) {
    await state.unsubscribe();
    state.unsubscribe = null;
  }
  const ch = await getCharacteristic(state.server, serviceUuid, charUuid);
  state.characteristic = ch;
  state.selected = { serviceUuid, charUuid };
  setWriteEnabled(true);
  if (doSub && (ch.properties.notify || ch.properties.indicate)) {
    state.unsubscribe = await subscribe(ch, onNotification);
    setStatus(`已訂閱 ${charUuid}`);
  } else {
    setStatus(`已選取寫入目標 ${charUuid}`);
  }
  renderGatt(state.dump, findPreferredCharacteristic(state.dump));
}

async function hookDevice(device) {
  state.device = device;
  device.addEventListener('gattserverdisconnected', () => {
    if (state.reconnecting) return;
    setAllChips('已斷線', 'off');
    setWriteEnabled(false);
    $('btn-reconnect').hidden = false;
    setStatus('連線已中斷。若官方 App 被打開，或頁面被切到背景，都可能發生。');
  });
  const server = await device.gatt.connect();
  state.server = server;
  const dump = await dumpGatt(server);
  state.dump = dump;
  const preferred = findPreferredCharacteristic(dump);
  if (preferred) {
    await selectCharacteristic(preferred.serviceUuid, preferred.charUuid, { subscribe: true });
  } else {
    state.characteristic = null;
    state.selected = null;
    setWriteEnabled(false);
  }
  renderGatt(dump, preferred);
  setAllChips(state.mock ? '模擬中' : '已連線', 'on');
  $('btn-disconnect').hidden = false;
  $('btn-reconnect').hidden = true;
  setStatus(`已連線：${device.name || device.id || '裝置'}`);
}

async function connect({ acceptAll = false } = {}) {
  if (state.mock) {
    await connectMock();
    return;
  }
  setAllChips('連線中…', 'wait');
  setStatus(acceptAll ? '請在系統視窗選擇裝置…' : '請選擇名稱以 Liber 開頭的裝置…');
  try {
    const device = await requestC1Device({ acceptAll });
    await hookDevice(device);
  } catch (err) {
    setAllChips('未連線', '');
    const msg = err?.name === 'NotFoundError'
      ? '沒有選到裝置，或附近沒有名稱以 Liber 開頭的設備。可改試「掃描全部裝置」。'
      : (err?.message || String(err));
    setStatus(msg);
  }
}

async function connectMock() {
  const api = createMockDevice();
  state.mockApi = api;
  $('mock-tools').hidden = false;
  await hookDevice(api.device);
}

async function disconnect() {
  state.reconnecting = false;
  if (state.unsubscribe) {
    await state.unsubscribe();
    state.unsubscribe = null;
  }
  try { state.device?.gatt?.disconnect(); } catch { /* ignore */ }
  state.device = null;
  state.server = null;
  state.characteristic = null;
  state.selected = null;
  setWriteEnabled(false);
  setAllChips('未連線', '');
  $('btn-disconnect').hidden = true;
  $('btn-reconnect').hidden = true;
  setStatus('已中斷連線。');
}

async function reconnect() {
  if (!state.device) {
    const permitted = await listPermittedDevices();
    const found = permitted.find((d) => (d.name || '').startsWith('Liber')) || permitted[0];
    if (!found) {
      setStatus('沒有可重新連線的裝置，請再按一次「連線 C1」。');
      return;
    }
    state.device = found;
  }
  state.reconnecting = true;
  setAllChips('重新連線…', 'wait');
  try {
    await hookDevice(state.device);
  } catch (err) {
    setAllChips('已斷線', 'off');
    setStatus(`重新連線失敗：${err.message || err}`);
  } finally {
    state.reconnecting = false;
  }
}

function renderChartLists(filter = '') {
  const q = filter.trim().toLowerCase();
  const fill = (root, records, removable) => {
    root.innerHTML = '';
    const items = records.filter((c) => !q || c.title.toLowerCase().includes(q));
    if (!items.length) {
      root.innerHTML = `<p class="hint">${removable ? '還沒有自製曲譜。' : '沒有符合的示範曲。'}</p>`;
      return;
    }
    for (const rec of items) {
      let parsed;
      try { parsed = parseChart(rec.text); } catch { parsed = null; }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chart-card';
      const accent = colorForChord(parsed?.bars[0]?.chord || 'C');
      btn.style.setProperty('--accent', accent);
      btn.innerHTML = `<strong>${rec.title}</strong><span>${parsed ? `${parsed.key} 調 · ${parsed.bpm} BPM · ${parsed.bars.length} 個和弦` : '曲譜格式需要檢查'}</span>`;
      btn.addEventListener('click', () => openChart(rec));
      if (removable) {
        const actions = document.createElement('div');
        actions.className = 'card-actions';
        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = '刪除';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          state.userCharts = state.userCharts.filter((c) => c.id !== rec.id);
          saveUserCharts(state.userCharts);
          renderChartLists($('chart-search').value);
        });
        actions.appendChild(del);
        btn.appendChild(actions);
      }
      root.appendChild(btn);
    }
  };
  fill($('demo-list'), DEMO_CHARTS, false);
  fill($('user-list'), state.userCharts, true);
}

function buildNeck() {
  const root = $('neck-leds');
  root.innerHTML = '';
  for (const pad of PADS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'led';
    b.dataset.label = pad.label;
    b.style.setProperty('--led', pad.color);
    b.innerHTML = `${pad.label}<small>${pad.index}</small>`;
    b.addEventListener('click', () => simulatePad(pad.label));
    root.appendChild(b);
  }
  const board = $('pad-board');
  board.innerHTML = '';
  for (const pad of PADS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pad-row';
    b.dataset.label = pad.label;
    b.style.setProperty('--led', pad.color);
    b.innerHTML = `<span>${pad.index}　${pad.label}</span><em>由琴頭數下來第 ${pad.index} 個</em>`;
    b.addEventListener('click', () => simulatePad(pad.label));
    board.appendChild(b);
  }
}

function simulatePad(label) {
  const paddleActive = state.player?.isRunning() ? 12 : 0;
  const bytes = packetForLabel(label, {
    paddle: paddleActive,
    posA: paddleActive ? 80 : 50,
    tempo: state.chart?.bpm || state.lastParsed?.tempo || 80,
  });
  if (state.mockApi) state.mockApi.emitNotification(bytes);
  else onNotification(bytes);
}

function updatePadHighlights() {
  const target = state.targetChord;
  const pressed = state.pressedLabel;
  document.querySelectorAll('.led, .pad-row').forEach((el) => {
    const label = el.dataset.label;
    el.classList.toggle('is-target', !!target && label === target);
    el.classList.toggle('is-pressed', !!pressed && label === pressed);
  });
}

function renderBars(chart, index) {
  const stage = $('bar-stage');
  stage.innerHTML = '';
  const track = document.createElement('div');
  track.className = 'bar-track';
  track.id = 'bar-track';
  chart.bars.forEach((bar, i) => {
    const el = document.createElement('div');
    el.className = 'chord-bar';
    el.dataset.index = String(i);
    el.style.background = colorForChord(bar.chord);
    el.textContent = bar.chord;
    if (i === index) el.classList.add('is-current');
    if (i < index) el.classList.add('is-past');
    track.appendChild(el);
  });
  stage.appendChild(track);
  scrollBars(index);
}

function scrollBars(index) {
  const track = $('bar-track');
  if (!track) return;
  const current = track.querySelector(`[data-index="${index}"]`);
  if (!current) return;
  const stage = $('bar-stage');
  const offset = current.offsetLeft - (stage.clientWidth - current.offsetWidth) / 2;
  track.style.transform = `translateX(${-Math.max(0, offset)}px)`;
  track.style.transition = 'transform 180ms linear';
  track.querySelectorAll('.chord-bar').forEach((el) => {
    const i = Number(el.dataset.index);
    el.classList.toggle('is-current', i === index);
    el.classList.toggle('is-past', i < index);
  });
}

function refreshScore() {
  if (!state.player || !state.chart) return;
  const score = state.player.score();
  $('play-score').textContent = `得分 ${score.hits} / ${score.total}`;
}

function onPlayFrame(frame) {
  const bar = frame.bar;
  const label = padForChord(bar.chord)?.label || bar.chord;
  state.targetChord = label;
  $('play-lyric').textContent = bar.lyric || ' ';
  $('play-prompt').textContent = frame.finished
    ? '這首結束了'
    : (state.player?.isRunning() ? `使用撥片 A · 請按 ${label}` : `準備好就按下開始 · 先記 ${label}`);
  scrollBars(frame.index);
  updatePadHighlights();
  refreshScore();
}

function openChart(record) {
  let chart;
  try {
    chart = parseChart(record.text);
  } catch (err) {
    alert(err.message);
    return;
  }
  state.chartRecord = record;
  state.chart = chart;
  if (state.player) state.player.reset();
  state.player = createPlayer(chart, {
    onFrame: onPlayFrame,
    onEnd: (score) => {
      $('btn-play').textContent = '開始彈唱';
      showRecap(score);
    },
  });
  $('play-title').textContent = record.title || chart.title;
  $('play-meta').textContent = `${chart.key} 調 · ${chart.bpm} BPM · ${chart.meter}`;
  $('play-source').textContent = record.sourceNote || '';
  $('play-score').textContent = `得分 0 / ${chart.bars.length}`;
  $('btn-play').textContent = '開始彈唱';
  renderBars(chart, 0);
  onPlayFrame({ ...{ index: 0, bar: chart.bars[0], progress: 0, finished: false } });
  showView('play');
}

function togglePlay() {
  if (!state.player) return;
  if (state.player.isRunning()) {
    state.player.pause();
    $('btn-play').textContent = '繼續彈唱';
    return;
  }
  state.player.start();
  $('btn-play').textContent = '暫停';
}

function resetPlay() {
  if (!state.player || !state.chart) return;
  state.player.reset();
  state.pressedLabel = null;
  $('btn-play').textContent = '開始彈唱';
  $('play-score').textContent = `得分 0 / ${state.chart.bars.length}`;
  renderBars(state.chart, 0);
  onPlayFrame({ index: 0, bar: state.chart.bars[0], progress: 0, finished: false });
}

function showRecap(score) {
  $('recap-title').textContent = state.chartRecord?.title || '練習結束';
  $('recap-grade').textContent = scoreLabel(score.ratio);
  $('recap-detail').textContent = `對了 ${score.hits} / ${score.total} 個和弦小節`;
  showView('recap');
}

function fillLearnSelect() {
  const sel = $('learn-action');
  sel.innerHTML = '';
  for (const action of ACTION_LIST) {
    const opt = document.createElement('option');
    opt.value = action.id;
    opt.textContent = action.experimental ? `${action.nameZh}（實驗性）` : action.nameZh;
    sel.appendChild(opt);
  }
}

function renderMidiInputs() {
  const box = $('midi-inputs');
  box.innerHTML = '';
  const items = listInputs(state.midiAccess);
  if (!items.length) {
    box.innerHTML = '<p class="hint">沒有看到 MIDI 輸入。</p>';
    return;
  }
  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'midi-item';
    div.textContent = `${item.name}${item.manufacturer ? `（${item.manufacturer}）` : ''}`;
    box.appendChild(div);
  }
}

function renderMaps() {
  const ul = $('midi-maps');
  ul.innerHTML = '';
  if (!state.midiMaps.length) {
    ul.innerHTML = '<li class="hint">還沒有對應。</li>';
    return;
  }
  for (const map of state.midiMaps) {
    const li = document.createElement('li');
    li.innerHTML = `<div><strong>${map.label}</strong><div class="hint">→ ${map.nameZh}</div></div>`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-quiet';
    del.style.width = 'auto';
    del.textContent = '刪除';
    del.addEventListener('click', () => {
      state.midiMaps = state.midiMaps.filter((m) => m.bindKey !== map.bindKey);
      saveMaps(state.midiMaps);
      renderMaps();
    });
    li.appendChild(del);
    ul.appendChild(li);
  }
}

function currentLearnOverrides(actionId) {
  const form = document.querySelector(`form[data-command="${actionId}"]`);
  return form ? formOverrides(form) : {};
}

async function handleMidiData(data) {
  const desc = describeMidiMessage(data);
  if (desc.kind === 'noteoff' || desc.kind === 'other') return;
  const bindKey = mappingKeyFromMessage(desc);
  if (!bindKey) return;
  if (state.learning) {
    const actionId = $('learn-action').value;
    const cmd = COMMANDS[actionId];
    state.midiMaps = upsertMapping(state.midiMaps, {
      bindKey,
      label: desc.label,
      actionId,
      fieldOverrides: currentLearnOverrides(actionId),
      nameZh: cmd?.nameZh || actionId,
      experimental: !!cmd?.experimental,
    });
    saveMaps(state.midiMaps);
    state.learning = false;
    $('btn-learn').textContent = '開始學習';
    $('learn-status').textContent = `已記住：${desc.label} → ${cmd?.nameZh || actionId}`;
    renderMaps();
    return;
  }
  const map = state.midiMaps.find((m) => m.bindKey === bindKey);
  if (!map) return;
  try {
    await sendCommand(buildCommand(map.actionId, map.fieldOverrides || {}), `MIDI ${map.label} → ${map.nameZh}`);
  } catch (err) {
    $('learn-status').textContent = `MIDI 觸發失敗：${err.message || err}`;
  }
}

function attachMidiInputs(access) {
  for (const input of access.inputs.values()) {
    input.onmidimessage = (event) => handleMidiData(Array.from(event.data));
  }
}

async function enableMidi() {
  try {
    const access = await requestAccess();
    state.midiAccess = access;
    access.onstatechange = () => { renderMidiInputs(); attachMidiInputs(access); };
    attachMidiInputs(access);
    renderMidiInputs();
    $('btn-learn').disabled = false;
    $('midi-status').textContent = 'MIDI 已啟用。';
  } catch (err) {
    $('midi-status').textContent = `無法啟用 MIDI：${err.message || err}`;
  }
}

function wireMockTools() {
  const box = $('mock-fixtures');
  box.innerHTML = '';
  for (const fixture of MOCK_FIXTURES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn-quiet';
    b.textContent = fixture.name;
    b.addEventListener('click', () => {
      if (state.mockApi) state.mockApi.emitNotification(fixture.bytes);
      else onNotification(fixture.bytes);
    });
    box.appendChild(b);
  }
  $('form-mock-hex').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      const bytes = parseHex($('mock-hex-input').value);
      if (state.mockApi) state.mockApi.emitNotification(bytes);
      else onNotification(bytes);
    } catch (err) {
      setStatus(err.message);
    }
  });
}

function featureDetect() {
  const ble = bluetoothAvailable() || state.mock;
  if (!ble) {
    $('support-banner').hidden = false;
    $('btn-connect').disabled = true;
    $('btn-connect-all').disabled = true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    $('support-text').textContent = ios
      ? 'iPhone / iPad 的 Safari 不支援 Web Bluetooth。請改用 Android 或電腦上的 Google Chrome。'
      : '這個瀏覽器沒有 Web Bluetooth。請用 Android 或電腦上的 Google Chrome 開啟本頁。';
  }
  if (!midiAvailable()) {
    $('btn-midi').disabled = true;
    $('midi-status').textContent = '這個瀏覽器沒有 Web MIDI。';
  }
}

function wire() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });
  $('songs-conn').addEventListener('click', () => showView('settings'));
  $('play-conn').addEventListener('click', () => showView('settings'));
  $('pads-conn').addEventListener('click', () => showView('settings'));
  $('chart-search').addEventListener('input', () => renderChartLists($('chart-search').value));
  $('btn-new-chart').addEventListener('click', () => {
    $('chart-title').value = '';
    $('chart-text').value = '';
    $('editor-error').textContent = '';
    showView('editor');
  });
  $('editor-back').addEventListener('click', () => showView('songs'));
  $('chart-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = $('chart-title').value.trim();
    const text = $('chart-text').value;
    try {
      const parsed = parseChart(title ? `標題: ${title}\n${text}` : text);
      const record = {
        title: parsed.title,
        text: title && !/^標題|^title/im.test(text) ? `標題: ${title}\n${text}` : text,
      };
      state.userCharts = upsertUserChart(state.userCharts, record);
      saveUserCharts(state.userCharts);
      renderChartLists();
      const saved = state.userCharts[0];
      openChart(saved);
    } catch (err) {
      $('editor-error').textContent = err.message;
    }
  });
  $('play-back').addEventListener('click', () => {
    if (state.player?.isRunning()) state.player.pause();
    showView('songs');
  });
  $('btn-play').addEventListener('click', togglePlay);
  $('btn-play-reset').addEventListener('click', resetPlay);
  $('btn-recap-again').addEventListener('click', () => {
    resetPlay();
    showView('play');
  });
  $('btn-recap-back').addEventListener('click', () => showView('songs'));

  $('btn-connect').addEventListener('click', () => connect({ acceptAll: false }));
  $('btn-connect-all').addEventListener('click', () => connect({ acceptAll: true }));
  $('btn-disconnect').addEventListener('click', disconnect);
  $('btn-reconnect').addEventListener('click', reconnect);
  $('btn-cmd-chord_mappings').addEventListener('click', () => {
    sendCommand(exactCommandBytes('chord_mappings'), '寫入和弦對應').catch(() => {});
  });
  document.querySelectorAll('form[data-command]').forEach((form) => {
    form.addEventListener('input', refreshPreviews);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const id = form.dataset.command;
      try {
        const bytes = buildCommand(id, formOverrides(form));
        const same = commandEqualsSourceDefault(id, bytes);
        sendCommand(bytes, `${COMMANDS[id].nameZh}${same ? '' : '（已改動）'}（實驗性）`).catch(() => {});
      } catch (err) {
        setStatus(err.message);
      }
    });
  });
  document.querySelectorAll('[data-exact]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.exact;
      sendCommand(exactCommandBytes(id), `${COMMANDS[id].nameZh}（來源原樣，實驗性）`).catch(() => {});
    });
  });
  $('hex-input').addEventListener('input', () => {
    try {
      const bytes = parseHex($('hex-input').value);
      $('hex-parsed').textContent = `${toHex(bytes)}  （${bytes.length} 位元組）`;
    } catch (err) {
      $('hex-parsed').textContent = err.message;
    }
  });
  $('form-hex').addEventListener('submit', (e) => {
    e.preventDefault();
    try {
      sendCommand(parseHex($('hex-input').value), '手動十六進位').catch(() => {});
    } catch (err) {
      setStatus(err.message);
    }
  });
  $('btn-midi').addEventListener('click', enableMidi);
  $('btn-learn').addEventListener('click', () => {
    state.learning = !state.learning;
    $('btn-learn').textContent = state.learning ? '取消學習' : '開始學習';
    $('learn-status').textContent = state.learning
      ? '等待 MIDI 訊息…'
      : '已取消學習。';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.device?.gatt?.connected) {
      setStatus('頁面已進入背景，連線可能隨時中斷。請回到這個分頁。');
    }
  });
}

function boot() {
  state.mock = isMockMode();
  fillLearnSelect();
  renderMaps();
  refreshPreviews();
  wireMockTools();
  buildNeck();
  renderChartLists();
  wire();
  featureDetect();
  if (state.mock) {
    $('mock-banner').hidden = false;
    $('btn-connect').textContent = '連上模擬 C1';
    connectMock();
  }
}

boot();
