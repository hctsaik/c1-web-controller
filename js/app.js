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

const MAX_LOG = 80;
const THEME_KEY = 'c1-web-controller.theme';

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
  learnActionId: 'set_key',
};

function isMockMode() {
  const q = new URLSearchParams(location.search);
  return q.get('mock') === '1' || q.get('mock') === 'true';
}

function initTheme() {
  const q = new URLSearchParams(location.search);
  const saved = q.get('theme') || localStorage.getItem(THEME_KEY);
  const theme = saved === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  $('btn-theme').textContent = theme === 'light' ? '深色' : '淺色';
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(THEME_KEY, next);
  $('btn-theme').textContent = next === 'light' ? '深色' : '淺色';
}

function setPill(text, kind) {
  const el = $('conn-pill');
  el.textContent = text;
  el.className = `pill pill-${kind}`;
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

function nowTime() {
  return new Date().toLocaleTimeString('zh-Hant-TW', { hour12: false });
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

function directionLabel(dir) {
  if (dir === 'up') return '向上';
  if (dir === 'down') return '向下';
  if (dir === 'center') return '中間帶';
  return '—';
}

function setThumb(id, value) {
  const el = $(id);
  if (!el) return;
  const v = value == null ? 50 : Number(value);
  const pct = Math.max(0, Math.min(100, v));
  el.style.bottom = `calc(${pct}% - 5px)`;
}

function renderLive(parsed, rawHex) {
  $('live-hex').textContent = rawHex || '—';
  $('debug-hex').textContent = rawHex || '尚無通知';
  if (!parsed) {
    $('live-key').textContent = '—';
    $('live-chord').textContent = '—';
    $('live-tempo').textContent = '—';
    $('live-mode').textContent = '';
    $('live-bits').textContent = '等待通知…';
    $('paddle-a-readout').textContent = '—';
    $('paddle-b-readout').textContent = '—';
    setThumb('paddle-a-thumb', 50);
    setThumb('paddle-b-thumb', 50);
    return;
  }
  $('live-key').textContent = parsed.keyName || (parsed.keyIndex == null ? '—' : String(parsed.keyIndex));
  $('live-chord').textContent = parsed.chord?.label || '—';
  $('live-tempo').textContent = parsed.tempo == null ? '—' : String(parsed.tempo);
  const modes = [];
  if (parsed.incomplete) modes.push(`封包偏短（${parsed.length} 位元組，來源會讀到 byte[10]）`);
  if (parsed.configMode) modes.push(`設定模式：byte[1]=${parsed.keyIndex}，byte[4]=${parsed.configByte4}`);
  if (parsed.playMode) modes.push(`演奏模式：${parsed.playMode}`);
  if (parsed.paddleLabel) modes.push(`撥片：${parsed.paddleLabel}`);
  $('live-mode').textContent = modes.join(' · ');
  $('live-bits').textContent = [
    `byte[0]=${parsed.byte0}`,
    `[1]調=${parsed.keyIndex}`,
    `[2]=${parsed.bits2}`,
    `[3]=${parsed.bits3}`,
    `[4]=${parsed.bits4}`,
    `[5]撥片=${parsed.paddleRaw}`,
    `[6]=${parsed.byte6}`,
    `[7]BPM=${parsed.tempo}`,
    `[8]=${parsed.byte8}`,
    `[9]A=${parsed.paddleA}`,
    `[10]B=${parsed.paddleB}`,
  ].join('  ');
  const fmt = (pos, dir, vel) => {
    if (pos == null) return '—';
    const parts = [String(pos)];
    if (dir) parts.push(directionLabel(dir));
    if (vel != null) parts.push(`速度 ${vel.toFixed(2)}`);
    return parts.join(' · ');
  };
  $('paddle-a-readout').textContent = fmt(parsed.paddleA, parsed.paddleADirection, parsed.paddleAVelocity);
  $('paddle-b-readout').textContent = fmt(parsed.paddleB, parsed.paddleBDirection, parsed.paddleBVelocity);
  setThumb('paddle-a-thumb', parsed.paddleA);
  setThumb('paddle-b-thumb', parsed.paddleB);
}

function prependLog(listEl, html, extraClass = '') {
  const li = document.createElement('li');
  if (extraClass) li.className = extraClass;
  li.innerHTML = html;
  listEl.prepend(li);
  while (listEl.children.length > MAX_LOG) listEl.removeChild(listEl.lastChild);
}

function onNotification(bytes) {
  const parsed = parseNotification(bytes);
  const hex = toHex(bytes);
  renderLive(parsed, hex);
  const summary = [
    parsed.keyName ? `調 ${parsed.keyName}` : `key ${parsed.keyIndex}`,
    parsed.chord ? `和弦 ${parsed.chord.label}` : '',
    parsed.paddleLabel || '',
    parsed.tempo != null ? `${parsed.tempo} BPM` : '',
  ].filter(Boolean).join(' · ');
  prependLog(
    $('notify-log'),
    `<time>${nowTime()}</time><span>${hex}</span><div class="hint">${summary}</div>`,
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
    const hex = toHex(bytes);
    prependLog(
      $('write-log'),
      `<time>${nowTime()}</time><span class="log-err">${hex}</span><div class="hint">${source} · 失敗：${err.message || err}</div>`,
      'log-err',
    );
    setStatus(`寫入失敗：${err.message || err}`);
    throw err;
  }
}

function propertyList(props) {
  return Object.entries(props)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .join(', ') || '（無屬性）';
}

function renderGatt(dump, preferred) {
  const root = $('gatt-dump');
  root.innerHTML = '';
  if (!dump || dump.length === 0) {
    root.textContent = '沒有讀到服務。若剛才是用「掃描全部裝置」，請確認 optionalServices 有包含目標 UUID。';
    return;
  }
  for (const service of dump) {
    const wrap = document.createElement('div');
    wrap.className = 'gatt-service';
    const title = document.createElement('h4');
    const official = service.uuid.toLowerCase() === SERVICE_UUID;
    title.textContent = `${service.uuid}${official ? '  ← 非官方記載的 C1 服務' : ''}`;
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
      const match = ch.uuid.toLowerCase() === CHARACTERISTIC_UUID
        && service.uuid.toLowerCase() === SERVICE_UUID;
      const meta = document.createElement('div');
      meta.className = 'char-meta';
      meta.textContent = `${ch.uuid}${match ? '  ← 非官方記載的特徵' : ''}\n${propertyList(ch.properties)}${isSel ? '\n目前寫入與通知的目標' : ''}`;
      const actions = document.createElement('div');
      actions.className = 'char-actions';
      if (ch.properties.notify || ch.properties.indicate) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-secondary';
        b.textContent = '訂閱通知';
        b.addEventListener('click', () => selectCharacteristic(service.uuid, ch.uuid, { subscribe: true }));
        actions.appendChild(b);
      }
      if (ch.properties.write || ch.properties.writeWithoutResponse) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-ghost';
        b.textContent = '設為寫入目標';
        b.addEventListener('click', () => selectCharacteristic(service.uuid, ch.uuid, { subscribe: false }));
        actions.appendChild(b);
      }
      row.appendChild(meta);
      row.appendChild(actions);
      wrap.appendChild(row);
    }
    root.appendChild(wrap);
  }
  if (preferred) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '已自動選取非官方記載的服務 / 特徵並訂閱通知。';
    root.prepend(p);
  } else {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '沒有找到非官方記載的服務 000000ff-… / 特徵 0000ff03-…。請從清單手動訂閱。';
    root.prepend(p);
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
    setPill('已斷線', 'off');
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
  const mock = !!state.mock;
  setPill(mock ? '模擬中' : '已連線', 'on');
  $('btn-disconnect').hidden = false;
  $('btn-reconnect').hidden = true;
  setStatus(`已連線：${device.name || device.id || '裝置'}`);
  const details = $('warn-details');
  if (details) details.open = false;
}

async function connect({ acceptAll = false } = {}) {
  if (state.mock) {
    await connectMock();
    return;
  }
  setPill('連線中…', 'wait');
  setStatus(acceptAll ? '請在系統視窗選擇裝置…' : '請選擇名稱以 Liber 開頭的裝置…');
  try {
    const device = await requestC1Device({ acceptAll });
    await hookDevice(device);
  } catch (err) {
    setPill('未連線', 'idle');
    const msg = err?.name === 'NotFoundError'
      ? '沒有選到裝置，或附近沒有名稱以 Liber 開頭的設備。可改試「掃描全部裝置」。'
      : (err?.message || String(err));
    setStatus(msg);
  }
}

async function connectMock() {
  const api = createMockDevice();
  state.mockApi = api;
  // Bypass writeBytes going to the mock characteristic through hookDevice
  await hookDevice(api.device);
  $('mock-tools').hidden = false;
}

async function disconnect() {
  state.reconnecting = false;
  if (state.unsubscribe) {
    await state.unsubscribe();
    state.unsubscribe = null;
  }
  try {
    state.device?.gatt?.disconnect();
  } catch { /* ignore */ }
  state.device = null;
  state.server = null;
  state.characteristic = null;
  state.selected = null;
  setWriteEnabled(false);
  setPill('未連線', 'idle');
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
  setPill('重新連線…', 'wait');
  try {
    await hookDevice(state.device);
  } catch (err) {
    setPill('已斷線', 'off');
    setStatus(`重新連線失敗：${err.message || err}`);
  } finally {
    state.reconnecting = false;
  }
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
  if (items.length === 0) {
    box.innerHTML = '<p class="empty">沒有看到 MIDI 輸入。請接上鍵盤或踏板後再試一次。</p>';
    return;
  }
  for (const item of items) {
    const div = document.createElement('div');
    div.className = 'midi-item';
    div.textContent = `${item.name}${item.manufacturer ? `（${item.manufacturer}）` : ''} · ${item.state}`;
    box.appendChild(div);
  }
}

function renderMaps() {
  const ul = $('midi-maps');
  ul.innerHTML = '';
  if (state.midiMaps.length === 0) {
    ul.innerHTML = '<li class="empty">還沒有對應。用上面的學習功能新增。</li>';
    return;
  }
  for (const map of state.midiMaps) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    const extra = map.fieldOverrides && Object.keys(map.fieldOverrides).length
      ? ` · 欄位 ${JSON.stringify(map.fieldOverrides)}`
      : '';
    info.innerHTML = `<strong>${map.label}</strong><div class="hint">→ ${map.nameZh}${map.experimental ? '（實驗性）' : ''}${extra}</div>`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn-ghost';
    del.textContent = '刪除';
    del.addEventListener('click', () => {
      state.midiMaps = state.midiMaps.filter((m) => m.bindKey !== map.bindKey);
      saveMaps(state.midiMaps);
      renderMaps();
    });
    li.appendChild(info);
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
    const bytes = buildCommand(map.actionId, map.fieldOverrides || {});
    await sendCommand(bytes, `MIDI ${map.label} → ${map.nameZh}`);
  } catch (err) {
    $('learn-status').textContent = `MIDI 觸發失敗：${err.message || err}`;
  }
}

function attachMidiInputs(access) {
  for (const input of access.inputs.values()) {
    input.onmidimessage = (event) => {
      handleMidiData(Array.from(event.data));
    };
  }
}

async function enableMidi() {
  try {
    const access = await requestAccess();
    state.midiAccess = access;
    access.onstatechange = () => {
      renderMidiInputs();
      attachMidiInputs(access);
    };
    attachMidiInputs(access);
    renderMidiInputs();
    $('midi-pill').textContent = '已啟用';
    $('midi-pill').classList.add('pill-on');
    $('btn-learn').disabled = false;
    $('midi-status').textContent = 'MIDI 已啟用。';
    $('learn-status').textContent = '選一個指令，按下「開始學習」，再在鍵盤或踏板上送出訊息。';
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
    b.className = 'btn btn-ghost';
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
  const midi = midiAvailable();
  if (!ble) {
    $('support-banner').hidden = false;
    $('btn-connect').disabled = true;
    $('btn-connect-all').disabled = true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    $('support-text').textContent = ios
      ? 'iPhone / iPad 的 Safari 不支援 Web Bluetooth。請改用 Android 或電腦上的 Google Chrome。'
      : '這個瀏覽器沒有 Web Bluetooth。請用 Android 或電腦上的 Google Chrome 開啟本頁。';
  }
  if (!midi) {
    $('btn-midi').disabled = true;
    $('midi-status').textContent = '這個瀏覽器沒有 Web MIDI。在 Android Chrome 通常可用。';
  }
}

function wire() {
  $('btn-theme').addEventListener('click', toggleTheme);
  $('btn-connect').addEventListener('click', () => connect({ acceptAll: false }));
  $('btn-connect-all').addEventListener('click', () => connect({ acceptAll: true }));
  $('btn-disconnect').addEventListener('click', disconnect);
  $('btn-reconnect').addEventListener('click', reconnect);
  $('btn-cmd-chord_mappings').addEventListener('click', () => {
    sendCommand(exactCommandBytes('chord_mappings'), '寫入和弦對應').catch(() => {});
  });
  document.querySelectorAll('form[data-command]').forEach((form) => {
    form.addEventListener('input', refreshPreviews);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = form.dataset.command;
      try {
        const bytes = buildCommand(id, formOverrides(form));
        const same = commandEqualsSourceDefault(id, bytes);
        const label = `${COMMANDS[id].nameZh}${same ? '' : '（已改動）'}（實驗性）`;
        sendCommand(bytes, label).catch(() => {});
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
      const bytes = parseHex($('hex-input').value);
      sendCommand(bytes, '手動十六進位').catch(() => {});
    } catch (err) {
      setStatus(err.message);
    }
  });
  $('btn-midi').addEventListener('click', enableMidi);
  $('btn-learn').addEventListener('click', () => {
    state.learning = !state.learning;
    $('btn-learn').textContent = state.learning ? '取消學習' : '開始學習';
    $('learn-status').textContent = state.learning
      ? '等待 MIDI 訊息（Note On、CC 或 Program Change）…'
      : '已取消學習。';
  });
  $('learn-action').addEventListener('change', () => {
    state.learnActionId = $('learn-action').value;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.device?.gatt?.connected) {
      setStatus('頁面已進入背景，連線可能隨時中斷。請回到這個分頁。');
    }
  });
}

function boot() {
  state.mock = isMockMode();
  initTheme();
  fillLearnSelect();
  renderMaps();
  refreshPreviews();
  wireMockTools();
  wire();
  featureDetect();
  if (state.mock) {
    $('mock-banner').hidden = false;
    $('btn-connect').textContent = '連上模擬 C1';
    connectMock();
  }
}

boot();
