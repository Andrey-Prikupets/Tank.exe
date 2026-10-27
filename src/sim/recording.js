import * as C from '../constants.js';
import { slotPos } from './world.js';

// ---------------------------------------------------------------------------
// Binary Stream Encoding / Decoding Helpers
// ---------------------------------------------------------------------------
export class BinaryWriter {
  constructor(initialCapacity = 65536) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
    this.offset = 0;
  }
  ensure(bytes) {
    if (this.offset + bytes > this.buffer.byteLength) {
      const next = new Uint8Array(Math.max(this.buffer.byteLength * 2, this.offset + bytes));
      next.set(this.buffer);
      this.buffer = next;
      this.view = new DataView(this.buffer.buffer);
    }
  }
  writeUint8(v) {
    this.ensure(1);
    this.view.setUint8(this.offset, v);
    this.offset += 1;
  }
  writeInt8(v) {
    this.ensure(1);
    this.view.setInt8(this.offset, v);
    this.offset += 1;
  }
  writeUint16(v) {
    this.ensure(2);
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
  }
  writeInt16(v) {
    this.ensure(2);
    this.view.setInt16(this.offset, v, true);
    this.offset += 2;
  }
  writeUint32(v) {
    this.ensure(4);
    this.view.setUint32(this.offset, v, true);
    this.offset += 4;
  }
  writeFloat32(v) {
    this.ensure(4);
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
  }
  getBytes() {
    return this.buffer.subarray(0, this.offset);
  }
}

export class BinaryReader {
  constructor(uint8Array) {
    this.buffer = uint8Array;
    this.view = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
    this.offset = 0;
  }
  readUint8() {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }
  readInt8() {
    const v = this.view.getInt8(this.offset);
    this.offset += 1;
    return v;
  }
  readUint16() {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  readInt16() {
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }
  readUint32() {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }
  readFloat32() {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }
  hasMore() {
    return this.offset < this.buffer.byteLength;
  }
}

// ---------------------------------------------------------------------------
// Deflate Compression & Base64 Encoding
// ---------------------------------------------------------------------------
export async function compressDeflate(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const res = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(res);
}

export async function decompressDeflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const res = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(res);
}

export function uint8ArrayToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function angleLerp(a, b, t) {
  let diff = (b - a) % (2 * Math.PI);
  if (diff < -Math.PI) diff += 2 * Math.PI;
  if (diff > Math.PI) diff -= 2 * Math.PI;
  return a + diff * t;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Match Recording System
// ---------------------------------------------------------------------------
export function createRecorder(initialWorld, options = {}) {
  const mode = options.mode || 'HvH';
  const modeLabel = options.modeLabel || 'Human vs Human';
  const aiLevel = options.aiLevel || null;
  const obstacles = initialWorld.obstacles ? initialWorld.obstacles.map((o) => ({ ...o })) : [];
  const pits = initialWorld.pits ? initialWorld.pits.map((p) => ({ ...p })) : [];

  const rawFrames = [];
  let lastSampleTime = -1;

  function sample(world) {
    if (world.time < 0) return;
    if (lastSampleTime >= 0 && world.time - lastSampleTime < C.REPLAY_SAMPLE_DT_S - 0.001) {
      return;
    }
    lastSampleTime = world.time;

    const p0 = world.players[0];
    const p1 = world.players[1];

    let deadTankMask = 0;
    const fieldTanks = [];
    for (let i = 0; i < world.tanks.length; i++) {
      const t = world.tanks[i];
      if (t.status === 'dead') {
        deadTankMask |= 1 << i;
      } else if (t.status === 'field') {
        fieldTanks.push({
          id: t.id,
          x: t.x,
          y: t.y,
          heading: t.heading,
          speed: t.speed,
          shells: Math.max(0, Math.min(15, t.shells)),
          mines: Math.max(0, Math.min(3, t.mines)),
          smokes: Math.max(0, Math.min(3, t.smokes)),
          reload: t.reload > 0 ? 1 : 0,
        });
      }
    }

    let eventMask = 0;
    if (world.events) {
      for (const ev of world.events) {
        if (ev.type === 'shoot' || ev.type === 'window_shoot') eventMask |= 1;
        if (ev.type === 'hit') eventMask |= 2;
        if (ev.type === 'explosion') eventMask |= 4;
        if (ev.type === 'pit_death') eventMask |= 8;
      }
    }

    rawFrames.push({
      t: world.time,
      p0: {
        selected: p0.selected,
        view: p0.view,
        windowIdx: p0.windowIdx,
        windowYaw: p0.windowYaw || 0,
        lost: p0.lost,
      },
      p1: {
        selected: p1.selected,
        view: p1.view,
        windowIdx: p1.windowIdx,
        windowYaw: p1.windowYaw || 0,
        lost: p1.lost,
      },
      gates: [
        world.gates ? world.gates[0].open : 0,
        world.gates ? world.gates[1].open : 0,
      ],
      deadTankMask,
      fieldTanks,
      shells: (world.shells || []).map((s) => ({
        owner: s.owner,
        x: s.x,
        y: s.y,
        vx: s.vx,
        vy: s.vy,
      })),
      mines: (world.mines || []).map((m) => ({
        owner: m.owner,
        x: m.x,
        y: m.y,
      })),
      smokes: (world.smokes || []).map((s) => ({
        x: s.x,
        y: s.y,
        r: s.r,
        t: s.t,
      })),
      explosions: (world.explosions || []).map((e) => ({
        x: e.x,
        y: e.y,
        t: e.t,
        big: !!e.big,
        splash: !!e.splash,
      })),
      eventMask,
    });
  }

  async function finalize(finalWorld) {
    if (rawFrames.length === 0 && finalWorld) {
      sample(finalWorld);
    }
    const duration = rawFrames.length > 0 ? rawFrames[rawFrames.length - 1].t : 0;
    const [a, b] = finalWorld.players;
    const winner = finalWorld.winner;
    const winnerLabel =
      winner === 'draw' ? 'DRAW' : winner === 0 ? 'RED WINS' : 'BLUE WINS';
    const score = `${15 - b.lost} - ${15 - a.lost}`;

    const metadata = {
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      savedAt: new Date().toISOString(),
      duration,
      mode,
      modeLabel,
      aiLevel,
      winner,
      winnerLabel,
      score,
      redLost: a.lost,
      blueLost: b.lost,
      pinned: false,
    };

    // Encode to binary buffer
    const w = new BinaryWriter();
    // Magic: "TNKR"
    w.writeUint32(0x544e4b52);
    // Version: 1
    w.writeUint8(1);
    w.writeFloat32(duration);

    // Obstacles
    w.writeUint8(obstacles.length);
    for (const ob of obstacles) {
      w.writeUint8(ob.id || 0);
      w.writeInt16(Math.round(ob.x * 10));
      w.writeInt16(Math.round(ob.y * 10));
      w.writeInt16(Math.round(ob.h * 1000));
      w.writeInt16(Math.round(ob.l * 10));
      w.writeInt16(Math.round(ob.w * 10));
    }

    // Pits
    w.writeUint8(pits.length);
    for (const p of pits) {
      w.writeUint8(p.id || 0);
      w.writeInt16(Math.round(p.x * 10));
      w.writeInt16(Math.round(p.y * 10));
      w.writeInt16(Math.round(p.h * 1000));
      w.writeInt16(Math.round(p.l * 10));
      w.writeInt16(Math.round(p.w * 10));
    }

    // Frames count
    w.writeUint32(rawFrames.length);
    for (const f of rawFrames) {
      w.writeUint16(Math.round(f.t * 10));

      // Player 0
      const p0Meta =
        ((f.p0.selected || 0) & 0x07) |
        (f.p0.view === 'window' ? 0x08 : 0) |
        (((f.p0.windowIdx || 0) & 0x01) << 4);
      w.writeUint8(p0Meta);
      w.writeInt16(Math.round(f.p0.windowYaw * 1000));
      w.writeUint8(f.p0.lost);

      // Player 1
      const p1Meta =
        ((f.p1.selected || 0) & 0x07) |
        (f.p1.view === 'window' ? 0x08 : 0) |
        (((f.p1.windowIdx || 0) & 0x01) << 4);
      w.writeUint8(p1Meta);
      w.writeInt16(Math.round(f.p1.windowYaw * 1000));
      w.writeUint8(f.p1.lost);

      // Gates (4 bits each)
      const g0 = Math.max(0, Math.min(15, Math.round(f.gates[0] * 15)));
      const g1 = Math.max(0, Math.min(15, Math.round(f.gates[1] * 15)));
      w.writeUint8(g0 | (g1 << 4));

      // Dead tanks bitmask
      w.writeUint32(f.deadTankMask >>> 0);

      // Active field tanks
      w.writeUint8(f.fieldTanks.length);
      for (const t of f.fieldTanks) {
        w.writeUint8(t.id);
        w.writeInt16(Math.round(t.x * 100));
        w.writeInt16(Math.round(t.y * 100));
        w.writeInt16(Math.round(t.heading * 10000));
        w.writeInt16(Math.round(t.speed * 100));
        w.writeUint8((t.shells & 0x0f) | ((t.mines & 0x03) << 4) | ((t.smokes & 0x03) << 6));
        w.writeUint8(t.reload ? 1 : 0);
      }

      // Shells
      w.writeUint8(f.shells.length);
      for (const s of f.shells) {
        w.writeUint8(s.owner);
        w.writeInt16(Math.round(s.x * 100));
        w.writeInt16(Math.round(s.y * 100));
        w.writeInt16(Math.round(s.vx * 10));
        w.writeInt16(Math.round(s.vy * 10));
      }

      // Mines
      w.writeUint8(f.mines.length);
      for (const m of f.mines) {
        w.writeUint8(m.owner);
        w.writeInt16(Math.round(m.x * 100));
        w.writeInt16(Math.round(m.y * 100));
      }

      // Smokes
      w.writeUint8(f.smokes.length);
      for (const sm of f.smokes) {
        w.writeInt16(Math.round(sm.x * 100));
        w.writeInt16(Math.round(sm.y * 100));
        w.writeInt16(Math.round(sm.t * 100));
      }

      // Explosions
      w.writeUint8(f.explosions.length);
      for (const e of f.explosions) {
        w.writeInt16(Math.round(e.x * 100));
        w.writeInt16(Math.round(e.y * 100));
        w.writeUint8(Math.max(0, Math.min(255, Math.round(e.t * 100))));
        w.writeUint8((e.big ? 1 : 0) | (e.splash ? 2 : 0));
      }

      // Event audio mask
      w.writeUint8(f.eventMask);
    }

    const uncompressedBytes = w.getBytes();
    const compressedBytes = await compressDeflate(uncompressedBytes);
    const base64Payload = uint8ArrayToBase64(compressedBytes);

    return { metadata, base64Payload };
  }

  return { sample, finalize, get frameCount() { return rawFrames.length; } };
}

// ---------------------------------------------------------------------------
// Binary Deserializer
// ---------------------------------------------------------------------------
export async function decodeRecording(base64Payload) {
  const compressedBytes = base64ToUint8Array(base64Payload);
  const uncompressedBytes = await decompressDeflate(compressedBytes);
  const r = new BinaryReader(uncompressedBytes);

  const magic = r.readUint32();
  if (magic !== 0x544e4b52) throw new Error('Invalid replay format magic');
  const version = r.readUint8();
  if (version !== 1) throw new Error(`Unsupported replay version: ${version}`);
  const duration = r.readFloat32();

  const obstaclesCount = r.readUint8();
  const obstacles = [];
  for (let i = 0; i < obstaclesCount; i++) {
    obstacles.push({
      id: r.readUint8(),
      x: r.readInt16() / 10,
      y: r.readInt16() / 10,
      h: r.readInt16() / 1000,
      l: r.readInt16() / 10,
      w: r.readInt16() / 10,
    });
  }

  const pitsCount = r.readUint8();
  const pits = [];
  for (let i = 0; i < pitsCount; i++) {
    pits.push({
      id: r.readUint8(),
      x: r.readInt16() / 10,
      y: r.readInt16() / 10,
      h: r.readInt16() / 1000,
      l: r.readInt16() / 10,
      w: r.readInt16() / 10,
    });
  }

  const frameCount = r.readUint32();
  const frames = [];

  for (let i = 0; i < frameCount; i++) {
    const t = r.readUint16() / 10;

    // Player 0
    const p0Meta = r.readUint8();
    const p0Selected = (p0Meta & 0x07) || null;
    const p0View = (p0Meta & 0x08) ? 'window' : 'tank';
    const p0WindowIdx = (p0Meta >> 4) & 0x01;
    const p0WindowYaw = r.readInt16() / 1000;
    const p0Lost = r.readUint8();

    // Player 1
    const p1Meta = r.readUint8();
    const p1Selected = (p1Meta & 0x07) || null;
    const p1View = (p1Meta & 0x08) ? 'window' : 'tank';
    const p1WindowIdx = (p1Meta >> 4) & 0x01;
    const p1WindowYaw = r.readInt16() / 1000;
    const p1Lost = r.readUint8();

    // Gates
    const gatesByte = r.readUint8();
    const g0 = (gatesByte & 0x0f) / 15;
    const g1 = ((gatesByte >> 4) & 0x0f) / 15;

    // Dead tanks bitmask
    const deadTankMask = r.readUint32();

    // Active field tanks
    const tankCount = r.readUint8();
    const fieldTanks = [];
    for (let k = 0; k < tankCount; k++) {
      const id = r.readUint8();
      const x = r.readInt16() / 100;
      const y = r.readInt16() / 100;
      const heading = r.readInt16() / 10000;
      const speed = r.readInt16() / 100;
      const ammo = r.readUint8();
      const shells = ammo & 0x0f;
      const mines = (ammo >> 4) & 0x03;
      const smokes = (ammo >> 6) & 0x03;
      const reload = r.readUint8() ? 1 : 0;
      fieldTanks.push({ id, x, y, heading, speed, shells, mines, smokes, reload });
    }

    // Shells
    const shellCount = r.readUint8();
    const shells = [];
    for (let k = 0; k < shellCount; k++) {
      shells.push({
        id: k,
        owner: r.readUint8(),
        x: r.readInt16() / 100,
        y: r.readInt16() / 100,
        vx: r.readInt16() / 10,
        vy: r.readInt16() / 10,
      });
    }

    // Mines
    const mineCount = r.readUint8();
    const mines = [];
    for (let k = 0; k < mineCount; k++) {
      mines.push({
        id: k,
        owner: r.readUint8(),
        x: r.readInt16() / 100,
        y: r.readInt16() / 100,
      });
    }

    // Smokes
    const smokeCount = r.readUint8();
    const smokes = [];
    for (let k = 0; k < smokeCount; k++) {
      smokes.push({
        id: k,
        x: r.readInt16() / 100,
        y: r.readInt16() / 100,
        t: r.readInt16() / 100,
        r: C.SMOKE_RADIUS_M,
      });
    }

    // Explosions
    const expCount = r.readUint8();
    const explosions = [];
    for (let k = 0; k < expCount; k++) {
      const x = r.readInt16() / 100;
      const y = r.readInt16() / 100;
      const expT = r.readUint8() / 100;
      const flags = r.readUint8();
      explosions.push({
        id: k,
        x,
        y,
        t: expT,
        big: !!(flags & 1),
        splash: !!(flags & 2),
      });
    }

    const eventMask = r.readUint8();

    frames.push({
      t,
      p0: { selected: p0Selected, view: p0View, windowIdx: p0WindowIdx, windowYaw: p0WindowYaw, lost: p0Lost },
      p1: { selected: p1Selected, view: p1View, windowIdx: p1WindowIdx, windowYaw: p1WindowYaw, lost: p1Lost },
      gates: [g0, g1],
      deadTankMask,
      fieldTanks,
      shells,
      mines,
      smokes,
      explosions,
      eventMask,
    });
  }

  return { duration, obstacles, pits, frames };
}

// ---------------------------------------------------------------------------
// LocalStorage Persistence with Dynamic Quota Pruning
// ---------------------------------------------------------------------------
export function listRecordings() {
  try {
    const raw = localStorage.getItem(C.REPLAY_INDEX_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    list.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    return list;
  } catch {
    return [];
  }
}

export function saveRecording(metadata, base64Payload) {
  const payloadKey = `${C.REPLAY_KEY_PREFIX}${metadata.id}`;

  function tryWrite() {
    try {
      localStorage.setItem(payloadKey, base64Payload);
      return true;
    } catch (err) {
      if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22)) {
        return false;
      }
      throw err;
    }
  }

  // 1. Try writing directly
  if (!tryWrite()) {
    // 2. Free space by pruning oldest unpinned match
    const index = listRecordings();
    for (let i = index.length - 1; i >= 0; i--) {
      const item = index[i];
      if (!item.pinned && item.id !== metadata.id) {
        deleteRecording(item.id);
        if (tryWrite()) break;
      }
    }
  }

  // 3. Update index
  const index = listRecordings().filter((it) => it.id !== metadata.id);
  index.unshift(metadata);
  index.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  try {
    localStorage.setItem(C.REPLAY_INDEX_KEY, JSON.stringify(index));
    return true;
  } catch (err) {
    console.warn('Could not save replay index:', err);
    return false;
  }
}

export function loadRecording(id) {
  const payloadKey = `${C.REPLAY_KEY_PREFIX}${id}`;
  const base64 = localStorage.getItem(payloadKey);
  if (!base64) return null;
  return base64;
}

export function setPinned(id, isPinned) {
  const index = listRecordings();
  const match = index.find((it) => it.id === id);
  if (!match) return false;
  match.pinned = !!isPinned;
  try {
    localStorage.setItem(C.REPLAY_INDEX_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

export function deleteRecording(id) {
  const payloadKey = `${C.REPLAY_KEY_PREFIX}${id}`;
  try {
    localStorage.removeItem(payloadKey);
  } catch {}
  const index = listRecordings().filter((it) => it.id !== id);
  try {
    localStorage.setItem(C.REPLAY_INDEX_KEY, JSON.stringify(index));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Playback Controller & State Interpolator
// ---------------------------------------------------------------------------
export function createPlayback(decodedReplay, targetWorld, sfx) {
  const { duration, frames } = decodedReplay;
  let currentTime = 0;
  let isPlaying = true;
  let speed = 1.0;
  let lastEventFrame = -1;

  function seek(t) {
    currentTime = Math.max(0, Math.min(duration, t));
    lastEventFrame = Math.floor(currentTime / C.REPLAY_SAMPLE_DT_S);
    interpolateWorld(targetWorld, currentTime);
  }

  function togglePlay() {
    isPlaying = !isPlaying;
    return isPlaying;
  }

  function setSpeed(newSpeed) {
    speed = newSpeed;
  }

  function update(dt) {
    if (isPlaying) {
      const prevTime = currentTime;
      currentTime = Math.min(duration, currentTime + dt * speed);
      if (currentTime >= duration) {
        isPlaying = false;
      }
      interpolateWorld(targetWorld, currentTime);

      // Trigger audio events if sfx is provided and playing forward
      if (sfx && sfx.enabled) {
        const curFrameIdx = Math.floor(currentTime / C.REPLAY_SAMPLE_DT_S);
        if (curFrameIdx > lastEventFrame && curFrameIdx < frames.length) {
          for (let fIdx = Math.max(0, lastEventFrame + 1); fIdx <= curFrameIdx; fIdx++) {
            const evMask = frames[fIdx].eventMask;
            if (evMask & 1) sfx.play({ type: 'shoot' });
            if (evMask & 2) sfx.play({ type: 'hit' });
            if (evMask & 4) sfx.play({ type: 'explosion' });
            if (evMask & 8) sfx.play({ type: 'pit_death' });
          }
          lastEventFrame = curFrameIdx;
        }
      }
    } else {
      interpolateWorld(targetWorld, currentTime);
    }
  }

  function interpolateWorld(world, t) {
    if (frames.length === 0) return;
    world.time = t;

    let idx = Math.floor(t / C.REPLAY_SAMPLE_DT_S);
    if (idx < 0) idx = 0;
    if (idx >= frames.length - 1) idx = frames.length - 1;

    const nextIdx = Math.min(frames.length - 1, idx + 1);
    const f1 = frames[idx];
    const f2 = frames[nextIdx];

    const dtFrames = f2.t - f1.t;
    const alpha = dtFrames > 0.0001 ? Math.max(0, Math.min(1, (t - f1.t) / dtFrames)) : 0;

    // Gates
    if (world.gates) {
      world.gates[0].open = lerp(f1.gates[0], f2.gates[0], alpha);
      world.gates[1].open = lerp(f1.gates[1], f2.gates[1], alpha);
    }

    // Players
    for (let p = 0; p < 2; p++) {
      const fp1 = p === 0 ? f1.p0 : f1.p1;
      const fp2 = p === 0 ? f2.p0 : f2.p1;
      const pl = world.players[p];
      pl.selected = fp1.selected;
      pl.view = fp1.view;
      pl.windowIdx = fp1.windowIdx;
      pl.windowYaw = angleLerp(fp1.windowYaw, fp2.windowYaw, alpha);
      if (pl.windowYaws) {
        pl.windowYaws[pl.windowIdx] = pl.windowYaw;
      }
      pl.lost = fp1.lost;
    }

    // Dead tanks from bitmask
    const deadMask = f1.deadTankMask;

    // Map active field tanks in f1 and f2
    const f1Map = new Map();
    for (const t of f1.fieldTanks) f1Map.set(t.id, t);
    const f2Map = new Map();
    for (const t of f2.fieldTanks) f2Map.set(t.id, t);

    for (const t of world.tanks) {
      const isDead = (deadMask & (1 << t.id)) !== 0;
      if (isDead) {
        t.status = 'dead';
        continue;
      }

      const t1 = f1Map.get(t.id);
      const t2 = f2Map.get(t.id);

      if (t1) {
        t.status = 'field';
        if (t2) {
          t.x = lerp(t1.x, t2.x, alpha);
          t.y = lerp(t1.y, t2.y, alpha);
          t.heading = angleLerp(t1.heading, t2.heading, alpha);
          t.speed = lerp(t1.speed, t2.speed, alpha);
        } else {
          t.x = t1.x;
          t.y = t1.y;
          t.heading = t1.heading;
          t.speed = t1.speed;
        }
        t.shells = t1.shells;
        t.mines = t1.mines;
        t.smokes = t1.smokes;
        t.reload = t1.reload;
      } else {
        // In hangar
        t.status = 'hangar';
        const p = slotPos(t.owner, t.row, t.i);
        t.x = p.x;
        t.y = p.y;
      }
    }

    // Shells
    world.shells = f1.shells.map((s) => ({
      owner: s.owner,
      x: s.x + s.vx * (alpha * C.REPLAY_SAMPLE_DT_S),
      y: s.y + s.vy * (alpha * C.REPLAY_SAMPLE_DT_S),
      vx: s.vx,
      vy: s.vy,
    }));

    // Mines
    world.mines = f1.mines;

    // Smokes
    world.smokes = f1.smokes;

    // Explosions
    world.explosions = f1.explosions;
  }

  // Initial update
  interpolateWorld(targetWorld, 0);

  return {
    seek,
    togglePlay,
    setSpeed,
    update,
    get isPlaying() { return isPlaying; },
    get currentTime() { return currentTime; },
    get duration() { return duration; },
    get speed() { return speed; },
  };
}
