import * as C from '../constants.js';

const slotKey = (i) => `${C.SAVE_KEY_PREFIX}${i}`;

export function slotInfo(i) {
  try {
    const raw = localStorage.getItem(slotKey(i));
    if (!raw) return null;
    const data = JSON.parse(raw);
    return { savedAt: data.savedAt, version: data.version };
  } catch {
    return null;
  }
}

export function saveSlot(i, world) {
  const snapshot = JSON.parse(JSON.stringify({ ...world, events: [] }));
  const data = { version: C.SAVE_FORMAT_VERSION, savedAt: new Date().toISOString(), world: snapshot };
  localStorage.setItem(slotKey(i), JSON.stringify(data));
}

/** Returns {world} or {error}. */
export function loadSlot(i) {
  const raw = localStorage.getItem(slotKey(i));
  if (!raw) return { error: 'Slot is empty' };
  try {
    const data = JSON.parse(raw);
    if (data.version !== C.SAVE_FORMAT_VERSION) return { error: 'Incompatible save version' };
    data.world.events = [];
    return { world: data.world };
  } catch {
    return { error: 'Save is corrupted' };
  }
}
