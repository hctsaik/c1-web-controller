import { CHARACTERISTIC_UUID, SERVICE_UUID, toHex } from './protocol.js';

function u8(arr) {
  const d = [0, 0, 0, 0, 0, 0, 0, 120, 0, 50, 50];
  for (let i = 0; i < arr.length; i++) d[i] = arr[i];
  return Uint8Array.from(d);
}

/** Hand-built fixtures for UI / screenshot demos. Not captured from a real C1. */
export const MOCK_FIXTURES = [
  { name: 'C 調、和弦 1、撥片中立、120 BPM', bytes: u8([0, 0, 0, 0, 16, 0, 0, 120, 0, 50, 50]) },
  { name: 'G 調、和弦 5、撥片 A 向下', bytes: u8([0, 4, 0, 0, 8, 12, 0, 100, 0, 80, 50]) },
  { name: 'D 調、和弦 6m、撥片 B 向上', bytes: u8([0, 1, 0, 0, 4, 3, 0, 88, 0, 50, 20]) },
  { name: 'A 調、演奏模式（根音上下）', bytes: u8([0, 5, 0, 0, 8, 64, 0, 112, 0, 50, 50]) },
  { name: '設定模式（byte[1]≥16）', bytes: u8([0, 16, 0, 0, 4, 0, 0, 120, 0, 50, 50]) },
];

export function createMockDevice({ onWrite } = {}) {
  const listeners = { value: [], disconnect: [] };
  let connected = false;
  let notifyOn = false;

  const characteristic = {
    uuid: CHARACTERISTIC_UUID,
    properties: {
      broadcast: false,
      read: false,
      write: true,
      writeWithoutResponse: true,
      notify: true,
      indicate: false,
    },
    addEventListener(type, fn) {
      if (type === 'characteristicvaluechanged') listeners.value.push(fn);
    },
    removeEventListener(type, fn) {
      listeners.value = listeners.value.filter((f) => f !== fn);
    },
    async startNotifications() {
      notifyOn = true;
    },
    async stopNotifications() {
      notifyOn = false;
    },
    async writeValueWithResponse(data) {
      const bytes = new Uint8Array(data);
      onWrite?.({ method: 'writeValueWithResponse', hex: toHex(bytes), bytes });
    },
    async writeValueWithoutResponse(data) {
      const bytes = new Uint8Array(data);
      onWrite?.({ method: 'writeValueWithoutResponse', hex: toHex(bytes), bytes });
    },
  };

  const service = {
    uuid: SERVICE_UUID,
    isPrimary: true,
    getCharacteristics: async () => [characteristic],
    getCharacteristic: async (uuid) => {
      if (String(uuid).toLowerCase() === CHARACTERISTIC_UUID) return characteristic;
      throw new Error('找不到特徵');
    },
  };

  const server = {
    connected: false,
    getPrimaryServices: async () => [service],
    getPrimaryService: async (uuid) => {
      if (String(uuid).toLowerCase() === SERVICE_UUID) return service;
      throw new Error('找不到服務');
    },
  };

  const device = {
    id: 'mock-c1',
    name: 'LiberLive C1（模擬）',
    gatt: {
      connected: false,
      connect: async () => {
        connected = true;
        server.connected = true;
        device.gatt.connected = true;
        return server;
      },
      disconnect: () => {
        connected = false;
        server.connected = false;
        device.gatt.connected = false;
        listeners.disconnect.forEach((fn) => fn());
      },
    },
    addEventListener(type, fn) {
      if (type === 'gattserverdisconnected') listeners.disconnect.push(fn);
    },
    removeEventListener(type, fn) {
      listeners.disconnect = listeners.disconnect.filter((f) => f !== fn);
    },
  };

  function emitNotification(bytes) {
    if (!notifyOn || !connected) return false;
    const buffer = Uint8Array.from(bytes);
    const event = { target: { value: { buffer: buffer.buffer, byteOffset: 0, byteLength: buffer.byteLength } } };
    // Use a DataView-like object: already have Uint8Array buffer. subscribe() slices the buffer.
    const value = new DataView(buffer.buffer);
    listeners.value.forEach((fn) => fn({ target: { value } }));
    return true;
  }

  return { device, server, characteristic, emitNotification };
}
