const STORAGE_KEY = 'c1-web-controller.midiMaps.v1';

export function midiAvailable() {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
}

export function loadMaps() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMaps(maps) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
}

export function describeMidiMessage(data) {
  if (!data || data.length === 0) return { kind: 'unknown', label: '空訊息' };
  const status = data[0];
  const type = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  if (type === 0x90 && (data[2] ?? 0) > 0) {
    return {
      kind: 'noteon',
      channel,
      note: data[1],
      value: data[2],
      label: `Note On  ch${channel}  #${data[1]}  vel ${data[2]}`,
    };
  }
  if (type === 0x80 || (type === 0x90 && (data[2] ?? 0) === 0)) {
    return {
      kind: 'noteoff',
      channel,
      note: data[1],
      value: data[2] ?? 0,
      label: `Note Off  ch${channel}  #${data[1]}`,
    };
  }
  if (type === 0xb0) {
    return {
      kind: 'cc',
      channel,
      controller: data[1],
      value: data[2],
      label: `CC  ch${channel}  #${data[1]}  ${data[2]}`,
    };
  }
  if (type === 0xc0) {
    return {
      kind: 'program',
      channel,
      program: data[1],
      label: `Program Change  ch${channel}  #${data[1]}`,
    };
  }
  return {
    kind: 'other',
    channel,
    label: `MIDI ${Array.from(data).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
  };
}

export function mappingKeyFromMessage(desc) {
  if (desc.kind === 'noteon') return `noteon:${desc.channel}:${desc.note}`;
  if (desc.kind === 'cc') return `cc:${desc.channel}:${desc.controller}`;
  if (desc.kind === 'program') return `program:${desc.channel}:${desc.program}`;
  return null;
}

export function upsertMapping(maps, { bindKey, label, actionId, fieldOverrides, nameZh, experimental }) {
  const next = maps.filter((m) => m.bindKey !== bindKey);
  next.push({
    bindKey,
    label,
    actionId,
    fieldOverrides: fieldOverrides || {},
    nameZh,
    experimental: !!experimental,
    updatedAt: Date.now(),
  });
  next.sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'));
  return next;
}

export async function requestAccess() {
  if (!midiAvailable()) throw new Error('這個瀏覽器沒有 Web MIDI');
  return navigator.requestMIDIAccess({ sysex: false });
}

export function listInputs(access) {
  const items = [];
  if (!access) return items;
  for (const input of access.inputs.values()) {
    items.push({
      id: input.id,
      name: input.name || '未命名輸入',
      manufacturer: input.manufacturer || '',
      state: input.state,
    });
  }
  return items;
}
