import {
  CHARACTERISTIC_UUID,
  OPTIONAL_SERVICES,
  SERVICE_UUID,
  toHex,
} from './protocol.js';

export function bluetoothAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

function normalizeUuid(uuid) {
  return String(uuid).toLowerCase();
}

export async function requestC1Device({ acceptAll = false } = {}) {
  if (!bluetoothAvailable()) {
    throw new Error('這個瀏覽器沒有 Web Bluetooth（請用 Android 或電腦上的 Chrome）');
  }
  const optionalServices = OPTIONAL_SERVICES;
  const options = acceptAll
    ? { acceptAllDevices: true, optionalServices }
    : { filters: [{ namePrefix: 'Liber' }], optionalServices };
  return navigator.bluetooth.requestDevice(options);
}

export async function listPermittedDevices() {
  if (!bluetoothAvailable() || typeof navigator.bluetooth.getDevices !== 'function') {
    return [];
  }
  try {
    return await navigator.bluetooth.getDevices();
  } catch {
    return [];
  }
}

export async function dumpGatt(server) {
  const services = await server.getPrimaryServices();
  const dump = [];
  for (const service of services) {
    const entry = { uuid: service.uuid, isPrimary: service.isPrimary, characteristics: [] };
    try {
      const chars = await service.getCharacteristics();
      for (const ch of chars) {
        const props = ch.properties;
        entry.characteristics.push({
          uuid: ch.uuid,
          properties: {
            broadcast: !!props.broadcast,
            read: !!props.read,
            write: !!props.write,
            writeWithoutResponse: !!props.writeWithoutResponse,
            notify: !!props.notify,
            indicate: !!props.indicate,
            authenticatedSignedWrites: !!props.authenticatedSignedWrites,
            reliableWrite: !!props.reliableWrite,
            writableAuxiliaries: !!props.writableAuxiliaries,
          },
        });
      }
    } catch (err) {
      entry.error = err?.message || String(err);
    }
    dump.push(entry);
  }
  return dump;
}

export function findPreferredCharacteristic(serverChars) {
  const wantService = normalizeUuid(SERVICE_UUID);
  const wantChar = normalizeUuid(CHARACTERISTIC_UUID);
  for (const service of serverChars) {
    if (normalizeUuid(service.uuid) !== wantService) continue;
    const hit = service.characteristics.find((c) => normalizeUuid(c.uuid) === wantChar);
    if (hit) return { serviceUuid: service.uuid, charUuid: hit.uuid, unofficialMatch: true };
  }
  return null;
}

export async function getCharacteristic(server, serviceUuid, charUuid) {
  const service = await server.getPrimaryService(serviceUuid);
  return service.getCharacteristic(charUuid);
}

export async function subscribe(characteristic, onValue) {
  const handler = (event) => {
    const value = event.target.value;
    const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    onValue(bytes);
  };
  characteristic.addEventListener('characteristicvaluechanged', handler);
  await characteristic.startNotifications();
  return () => {
    characteristic.removeEventListener('characteristicvaluechanged', handler);
    return characteristic.stopNotifications().catch(() => {});
  };
}

export async function writeBytes(characteristic, bytes) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const props = characteristic.properties || {};
  let method = 'writeValueWithResponse';
  try {
    if (typeof characteristic.writeValueWithResponse === 'function' && (props.write || !props.writeWithoutResponse)) {
      await characteristic.writeValueWithResponse(data);
      method = 'writeValueWithResponse';
    } else if (typeof characteristic.writeValueWithoutResponse === 'function') {
      await characteristic.writeValueWithoutResponse(data);
      method = 'writeValueWithoutResponse';
    } else if (typeof characteristic.writeValue === 'function') {
      await characteristic.writeValue(data);
      method = 'writeValue';
    } else {
      throw new Error('這個特徵不支援寫入');
    }
  } catch (err) {
    if (method === 'writeValueWithResponse' && typeof characteristic.writeValueWithoutResponse === 'function') {
      await characteristic.writeValueWithoutResponse(data);
      method = 'writeValueWithoutResponse (fallback)';
    } else {
      throw err;
    }
  }
  return { method, hex: toHex(data), length: data.length };
}
