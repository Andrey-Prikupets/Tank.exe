import * as C from '../constants.js';
import { satOverlap, segmentVsObb, circleTouchesObb } from './geometry.js';
import { generateObstacles, generatePits, tankPitOverlap } from './terrain.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, target, maxDelta) =>
  v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);

// ---------------------------------------------------------------------------
// Static geometry helpers (shared with renderers)
// ---------------------------------------------------------------------------
export const gateX = (owner) => (owner === 0 ? 0 : C.FIELD_LENGTH_M);
export const inwardDir = (owner) => (owner === 0 ? 1 : -1);
export const baseHeading = (owner) => (owner === 0 ? 0 : Math.PI);

/** idx 0 = "left" window (as seen looking out of the gate), idx 1 = "right". */
export function windowY(owner, idx) {
  const sign = (owner === 0 ? -1 : 1) * (idx === 0 ? 1 : -1);
  return C.GATE_CENTER_Y_M + sign * C.WINDOW_OFFSET_FROM_GATE_M;
}

export function slotPos(owner, row, i) {
  const off = C.HANGAR_FIRST_ROW_OFFSET_M + row * C.HANGAR_ROW_PITCH_M;
  const x = owner === 0 ? -off : C.FIELD_LENGTH_M + off;
  const y = C.GATE_CENTER_Y_M + (i - (C.HANGAR_SLOTS_PER_ROW - 1) / 2) * C.HANGAR_SLOT_PITCH_M;
  return { x, y };
}

export function inDeadZone(owner, x, y) {
  const depth = Math.abs(x - gateX(owner));
  const inside = owner === 0 ? x >= 0 : x <= C.FIELD_LENGTH_M;
  return (
    inside &&
    depth <= C.DEAD_ZONE_DEPTH_M &&
    Math.abs(y - C.GATE_CENTER_Y_M) <= C.GATE_WIDTH_M / 2 + C.DEAD_ZONE_SIDE_MARGIN_M
  );
}

const inGateGap = (y) => Math.abs(y - C.GATE_CENTER_Y_M) <= C.GATE_WIDTH_M / 2;

export const body = (t) => ({ x: t.x, y: t.y, h: t.heading, l: C.TANK_LENGTH_M, w: C.TANK_WIDTH_M });

// ---------------------------------------------------------------------------
// World creation
// ---------------------------------------------------------------------------
function makeTank(id, owner) {
  return {
    id,
    owner,
    number: null,
    status: 'hangar', // 'field' | 'hangar' | 'dead'
    deployRequested: false,
    row: 0,
    i: 0,
    x: 0,
    y: 0,
    heading: baseHeading(owner),
    speed: 0,
    turn: 0,
    cmdSpeedKmh: 0,
    cmdTurnDeg: 0,
    shells: C.TANK_START_SHELLS,
    mines: C.TANK_START_MINES,
    smokes: C.TANK_START_SMOKES,
    reload: 0,
    contacts: [],
  };
}

function placeInHangar(t, row, i) {
  const p = slotPos(t.owner, row, i);
  t.status = 'hangar';
  t.deployRequested = false;
  t.row = row;
  t.i = i;
  t.x = p.x;
  t.y = p.y;
  t.heading = baseHeading(t.owner);
  t.speed = 0;
  t.turn = 0;
  t.cmdSpeedKmh = 0;
  t.cmdTurnDeg = 0;
  t.contacts = [];
}

export function createWorld(options = {}) {
  const world = {
    version: C.SAVE_FORMAT_VERSION,
    time: 0,
    over: false,
    winner: null, // 0 | 1 | 'draw'
    players: [0, 1].map((id) => ({
      id,
      selected: C.TANK_NUMBERS[id][0],
      view: 'tank', // 'tank' | 'window'
      windowIdx: 0,
      windowYaw: 0,
      windowReload: 0,
      lost: 0,
      shots: 0,
      hits: 0,
      msg: '',
      msgT: 0,
      blocked: false,
    })),
    gates: [{ open: 0 }, { open: 0 }], // sliding door open fraction 0..1 per owner
    tanks: [],
    shells: [],
    mines: [],
    smokes: [],
    explosions: [],
    events: [],
    obstacles: options.obstacles ? generateObstacles() : [],
    pits: options.pits ? generatePits(options.obstacles ? [] : []) : [],
  };
  if (options.pits) {
    world.pits = generatePits(world.obstacles);
  }

  for (const owner of [0, 1]) {
    const nums = C.TANK_NUMBERS[owner];
    for (let k = 0; k < C.TANKS_ON_FIELD_MAX; k++) {
      const t = makeTank(owner * C.TANKS_PER_PLAYER + k, owner);
      t.number = nums[k];
      t.status = 'field';
      t.x =
        owner === 0
          ? C.START_BORDER_GAP_M + C.TANK_LENGTH_M / 2
          : C.FIELD_LENGTH_M - C.START_BORDER_GAP_M - C.TANK_LENGTH_M / 2;
      t.y = C.GATE_CENTER_Y_M + (k - (C.TANKS_ON_FIELD_MAX - 1) / 2) * C.START_SPACING_M;
      world.tanks.push(t);
    }
    let n = C.TANKS_ON_FIELD_MAX;
    for (let row = 0; row < C.HANGAR_ROWS; row++) {
      for (let i = 0; i < C.HANGAR_SLOTS_PER_ROW; i++) {
        const t = makeTank(owner * C.TANKS_PER_PLAYER + n++, owner);
        placeInHangar(t, row, i);
        world.tanks.push(t);
      }
    }
  }
  return world;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
export const tankByNumber = (world, owner, num) =>
  world.tanks.find((t) => t.owner === owner && t.number === num && t.status !== 'dead') || null;

export const selectedTank = (world, p) => {
  const pl = world.players[p];
  return pl.selected == null ? null : tankByNumber(world, p, pl.selected);
};

const fieldTanks = (world) => world.tanks.filter((t) => t.status === 'field');
const hangarTankAt = (world, owner, row, i) =>
  world.tanks.find((t) => t.owner === owner && t.status === 'hangar' && t.row === row && t.i === i);

function freeSlot(world, owner) {
  for (let row = 0; row < C.HANGAR_ROWS; row++) {
    for (let i = 0; i < C.HANGAR_SLOTS_PER_ROW; i++) {
      if (!hangarTankAt(world, owner, row, i)) return { row, i };
    }
  }
  return null;
}

export const hangarCount = (world, owner) =>
  world.tanks.filter((t) => t.owner === owner && t.status === 'hangar').length;

function setMsg(world, p, text, dur = C.MESSAGE_DURATION_S) {
  world.players[p].msg = text;
  world.players[p].msgT = dur;
}

const emit = (world, type, x, owner) => world.events.push({ type, x, owner });

/** Camera pose for a player's 3D view. */
export function viewPose(world, p) {
  const pl = world.players[p];
  const dir = inwardDir(p);
  if (pl.view === 'window') {
    return {
      kind: 'window',
      x: gateX(p) + dir * C.WINDOW_CAMERA_INSET_M,
      y: windowY(p, pl.windowIdx),
      heading: baseHeading(p) + pl.windowYaw,
      hideId: null,
    };
  }
  const t = selectedTank(world, p);
  if (t && t.status === 'field') {
    return { kind: 'tank', x: t.x, y: t.y, heading: t.heading, hideId: t.id };
  }
  return {
    kind: 'gate',
    x: gateX(p) + dir * C.WINDOW_CAMERA_INSET_M,
    y: C.GATE_CENTER_Y_M,
    heading: baseHeading(p),
    hideId: null,
  };
}

// ---------------------------------------------------------------------------
// Actions (from input)
// ---------------------------------------------------------------------------
export function applyAction(world, p, action, arg) {
  if (world.over) return;
  const pl = world.players[p];
  const tank = selectedTank(world, p);
  const live = tank && tank.status === 'field' && pl.view === 'tank';
  switch (action) {
    case 'SELECT': {
      pl.view = 'tank';
      const t = tankByNumber(world, p, arg);
      if (!t) {
        pl.selected = null;
        setMsg(world, p, `TANK ${arg} NOT AVAILABLE`);
      } else {
        pl.selected = arg;
        pl.msgT = 0;
        if (t.status === 'hangar') {
          setMsg(world, p, `TANK ${arg} IN HANGAR — PRESS FORWARD TO EXIT GATE`, C.MESSAGE_DURATION_S * 2);
        }
      }
      break;
    }
    case 'FORWARD':
      if (live) {
        tank.cmdSpeedKmh = clamp(tank.cmdSpeedKmh + C.SPEED_STEP_KMH, -C.TANK_MAX_REVERSE_KMH, C.TANK_MAX_SPEED_KMH);
        if (tank.cmdSpeedKmh !== 0) {
          tank.cmdTurnDeg = clamp(tank.cmdTurnDeg, -C.TANK_MAX_TURN_DEG_S, C.TANK_MAX_TURN_DEG_S);
        }
      } else if (tank && tank.status === 'hangar' && pl.view === 'tank') {
        tank.deployRequested = true;
        setMsg(world, p, `EXITING GATE WITH TANK ${tank.number}...`);
      }
      break;
    case 'BACK':
      if (live) {
        tank.cmdSpeedKmh = clamp(tank.cmdSpeedKmh - C.SPEED_STEP_KMH, -C.TANK_MAX_REVERSE_KMH, C.TANK_MAX_SPEED_KMH);
        if (tank.cmdSpeedKmh !== 0) {
          tank.cmdTurnDeg = clamp(tank.cmdTurnDeg, -C.TANK_MAX_TURN_DEG_S, C.TANK_MAX_TURN_DEG_S);
        }
      }
      break;
    case 'TURN_L':
      if (live) {
        const maxLimit = tank.cmdSpeedKmh === 0 ? C.TANK_MAX_PIVOT_TURN_DEG_S : C.TANK_MAX_TURN_DEG_S;
        tank.cmdTurnDeg = clamp(tank.cmdTurnDeg - C.TURN_STEP_DEG_S, -maxLimit, maxLimit);
      }
      break;
    case 'TURN_R':
      if (live) {
        const maxLimit = tank.cmdSpeedKmh === 0 ? C.TANK_MAX_PIVOT_TURN_DEG_S : C.TANK_MAX_TURN_DEG_S;
        tank.cmdTurnDeg = clamp(tank.cmdTurnDeg + C.TURN_STEP_DEG_S, -maxLimit, maxLimit);
      }
      break;
    case 'WIN_L':
    case 'WIN_R': {
      const idx = action === 'WIN_L' ? 0 : 1;
      if (pl.view === 'window' && pl.windowIdx === idx) {
        pl.view = 'tank';
      } else {
        pl.view = 'window';
        pl.windowIdx = idx;
        pl.windowYaw = 0;
      }
      break;
    }
    case 'FIRE':
      if (pl.view === 'window') {
        if (pl.windowReload <= 0) {
          pl.windowReload = C.WINDOW_RELOAD_S;
          const v = viewPose(world, p);
          spawnShell(world, p, v.x, v.y, v.heading, true);
        }
      } else if (live) {
        if (tank.shells <= 0) setMsg(world, p, 'NO AMMO', 1.5);
        else if (tank.reload <= 0) {
          tank.shells--;
          tank.reload = C.GUN_RELOAD_S;
          const d = C.TANK_LENGTH_M / 2 + C.SHELL_MUZZLE_OFFSET_M;
          spawnShell(world, p, tank.x + Math.cos(tank.heading) * d, tank.y + Math.sin(tank.heading) * d, tank.heading, false);
        }
      }
      break;
    case 'MINE':
      if (live) {
        if (tank.mines <= 0) setMsg(world, p, 'NO MINES', 1.5);
        else {
          tank.mines--;
          const d = C.TANK_LENGTH_M / 2 + C.MINE_DROP_BEHIND_M;
          world.mines.push({
            owner: p,
            x: tank.x - Math.cos(tank.heading) * d,
            y: tank.y - Math.sin(tank.heading) * d,
            armT: C.MINE_ARM_DELAY_S,
          });
          emit(world, 'mine', tank.x, p);
        }
      }
      break;
    case 'SMOKE':
      if (live) {
        if (tank.smokes <= 0) setMsg(world, p, 'NO SMOKE', 1.5);
        else {
          tank.smokes--;
          world.smokes.push({ x: tank.x, y: tank.y, t: 0 });
          emit(world, 'smoke', tank.x, p);
        }
      }
      break;
    default:
  }
}

function spawnShell(world, owner, x, y, heading, win) {
  world.shells.push({ owner, x, y, dx: Math.cos(heading), dy: Math.sin(heading), dist: 0, win });
  world.players[owner].shots++;
  emit(world, 'shot', x, owner);
}

export const playerKeyForTank = (owner, num) => {
  const idx = C.TANK_NUMBERS[owner].indexOf(num);
  return idx >= 0 ? C.PLAYER_KEY_LABELS[owner][idx] : num;
};

// ---------------------------------------------------------------------------
// Destruction
// ---------------------------------------------------------------------------
function kill(world, t, killerOwner, big, reason) {
  if (t.status === 'dead') return;
  const wasNumber = t.number;
  t.status = 'dead';
  t.number = null;
  t.speed = 0;
  if (reason === 'pit') {
    world.explosions.push({ x: t.x, y: t.y, t: 0, big: true, splash: true });
    emit(world, 'splash', t.x, t.owner);
  } else {
    world.explosions.push({ x: t.x, y: t.y, t: 0, big: !!big });
    emit(world, big ? 'mineBoom' : 'boom', t.x, t.owner);
  }
  const pl = world.players[t.owner];
  pl.lost++;
  if (killerOwner != null && killerOwner !== t.owner) world.players[killerOwner].hits++;

  if (wasNumber != null) {
    const spares = world.tanks
      .filter((s) => s.owner === t.owner && s.status === 'hangar' && s.number == null)
      .sort((a, b) => a.row - b.row || a.i - b.i);
    const spare = spares[0];
    if (spare) spare.number = wasNumber;
    if (pl.selected === wasNumber) {
      pl.selected = null;
      const msg = reason === 'pit'
        ? (spare ? `TANK ${wasNumber} DROPPED INTO PIT` : `TANK ${wasNumber} DROPPED INTO PIT — NO SPARES`)
        : (spare ? `TANK ${wasNumber} DESTROYED` : `TANK ${wasNumber} DESTROYED — NO SPARES`);
      setMsg(world, t.owner, msg, C.MESSAGE_DURATION_S * 2);
    }
  }
}

// ---------------------------------------------------------------------------
// Simulation step
// ---------------------------------------------------------------------------
function moveTank(t, dt) {
  t.speed = approach(t.speed, C.kmhToMs(t.cmdSpeedKmh), C.TANK_LINEAR_ACCEL_MS2 * dt);
  if (t.cmdSpeedKmh !== 0) {
    t.cmdTurnDeg = clamp(t.cmdTurnDeg, -C.TANK_MAX_TURN_DEG_S, C.TANK_MAX_TURN_DEG_S);
  }
  const targetTurn = C.degToRad(t.cmdTurnDeg);
  t.turn = approach(t.turn, targetTurn, C.degToRad(C.TANK_TURN_ACCEL_DEG_S2) * dt);

  const wall = t.contacts.some((c) => c.kind === 'wall');
  const any = t.contacts.length > 0;
  let turnFactor = 1;
  if (wall) turnFactor = Math.min(turnFactor, C.BORDER_DRAG_FACTOR);
  if (any) turnFactor = Math.min(turnFactor, wall ? C.BORDER_DRAG_FACTOR : C.TANK_CONTACT_TURN_FACTOR);
  t.heading += t.turn * turnFactor * dt;

  const sp = t.speed * (wall ? C.BORDER_DRAG_FACTOR : 1);
  let dx = Math.cos(t.heading) * sp * dt;
  let dy = Math.sin(t.heading) * sp * dt;
  for (const c of t.contacts) {
    const dot = dx * c.nx + dy * c.ny;
    if (dot < 0) {
      dx -= dot * c.nx;
      dy -= dot * c.ny;
    }
  }
  t.x += dx;
  t.y += dy;
}

function corners(t) {
  const c = Math.cos(t.heading);
  const s = Math.sin(t.heading);
  const hl = C.TANK_LENGTH_M / 2;
  const hw = C.TANK_WIDTH_M / 2;
  const pts = [];
  for (const sl of [1, -1]) {
    for (const sw of [1, -1]) {
      pts.push([t.x + c * hl * sl - s * hw * sw, t.y + s * hl * sl + c * hw * sw]);
    }
  }
  return pts;
}

function borderPush(t, gateOpen) {
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  for (const [x, y] of corners(t)) {
    if (x < 0 && !(t.owner === 0 && gateOpen[0] && inGateGap(y))) left = Math.max(left, -x);
    if (x > C.FIELD_LENGTH_M && !(t.owner === 1 && gateOpen[1] && inGateGap(y))) right = Math.max(right, x - C.FIELD_LENGTH_M);
    if (y < 0) top = Math.max(top, -y);
    if (y > C.FIELD_WIDTH_M) bottom = Math.max(bottom, y - C.FIELD_WIDTH_M);
  }
  if (left) {
    t.x += left;
    t.contacts.push({ kind: 'wall', nx: 1, ny: 0 });
  }
  if (right) {
    t.x -= right;
    t.contacts.push({ kind: 'wall', nx: -1, ny: 0 });
  }
  if (top) {
    t.y += top;
    t.contacts.push({ kind: 'wall', nx: 0, ny: 1 });
  }
  if (bottom) {
    t.y -= bottom;
    t.contacts.push({ kind: 'wall', nx: 0, ny: -1 });
  }
}

function resolveCollisions(world) {
  const field = fieldTanks(world);
  field.forEach((t) => (t.contacts = []));
  const gateOpen = [0, 1].map((o) => gatePassable(world, o));
  for (let iter = 0; iter < 2; iter++) {
    for (let a = 0; a < field.length; a++) {
      for (let b = a + 1; b < field.length; b++) {
        const ov = satOverlap(body(field[a]), body(field[b]));
        if (!ov) continue;
        const half = ov.depth / 2;
        field[a].x += ov.nx * half;
        field[a].y += ov.ny * half;
        field[b].x -= ov.nx * half;
        field[b].y -= ov.ny * half;
        field[a].contacts.push({ kind: 'tank', nx: ov.nx, ny: ov.ny });
        field[b].contacts.push({ kind: 'tank', nx: -ov.nx, ny: -ov.ny });
      }
    }
    for (const t of field) {
      borderPush(t, gateOpen);
      if (world.obstacles) {
        for (const ob of world.obstacles) {
          const ov = satOverlap(body(t), ob);
          if (ov) {
            t.x += ov.nx * ov.depth;
            t.y += ov.ny * ov.depth;
            t.contacts.push({ kind: 'wall', nx: ov.nx, ny: ov.ny });
          }
        }
      }
    }
  }
}

function handleGateEntry(world) {
  for (const t of fieldTanks(world)) {
    const crossed = t.owner === 0 ? t.x < 0 : t.x > C.FIELD_LENGTH_M;
    if (!crossed) continue;
    const slot = freeSlot(world, t.owner);
    if (!slot) continue;
    placeInHangar(t, slot.row, slot.i);
    t.shells = C.TANK_START_SHELLS;
    t.mines = C.TANK_START_MINES;
    t.smokes = C.TANK_START_SMOKES;
    t.reload = 0;
    const pl = world.players[t.owner];
    if (pl.selected === t.number) {
      pl.selected = null;
      setMsg(world, t.owner, `TANK ${t.number} IN HANGAR — SELECT TANK ${t.number} THEN PRESS FORWARD`);
    }
    emit(world, 'rearm', t.x, t.owner);
  }
}

/** Door is open far enough for a tank to drive through AND the hangar has room. */
function gatePassable(world, owner) {
  return world.gates[owner].open >= C.GATE_PASSABLE_FRACTION && !!freeSlot(world, owner);
}

/** Which gates want to be open this tick (own tank approaching / standing in the doorway). */
function gateWants(world) {
  const wants = [false, false];
  for (const t of fieldTanks(world)) {
    const o = t.owner;
    const dir = inwardDir(o);
    const lateral = Math.abs(t.y - C.GATE_CENTER_Y_M);
    // Standing in (or just in front of) the doorway: keep the doors open.
    for (const [x, y] of corners(t)) {
      const depth = dir * (x - gateX(o));
      if (depth <= C.GATE_DOOR_CLEAR_M && Math.abs(y - C.GATE_CENTER_Y_M) <= C.GATE_WIDTH_M / 2 + 1) wants[o] = true;
    }
    // Driving toward own gate with room to enter: open in advance.
    const depthC = dir * (t.x - gateX(o));
    const towardGate = -dir * Math.cos(t.heading) > 0.5 && t.speed > 0.5;
    if (towardGate && depthC <= C.GATE_APPROACH_M && lateral <= C.GATE_WIDTH_M / 2 + 2 && freeSlot(world, o)) wants[o] = true;
  }
  return wants;
}

function updateGates(world, dt, wants) {
  for (const o of [0, 1]) {
    const g = world.gates[o];
    const delta = dt / C.GATE_OPEN_TIME_S;
    g.open = clamp(g.open + (wants[o] ? delta : -delta), 0, 1);
  }
}

function tryDeploys(world, wants) {
  const field = fieldTanks(world);
  for (const pl of world.players) {
    const t = selectedTank(world, pl.id);
    if (!t || t.status !== 'hangar' || !t.deployRequested) {
      pl.blocked = false;
      continue;
    }
    const dir = inwardDir(pl.id);
    const spawn = {
      x: gateX(pl.id) + dir * (C.SPAWN_OFFSET_FROM_GATE_M + C.TANK_LENGTH_M / 2),
      y: C.GATE_CENTER_Y_M,
      h: baseHeading(pl.id),
      l: C.TANK_LENGTH_M + 2 * C.SPAWN_CLEARANCE_M,
      w: C.TANK_WIDTH_M + 2 * C.SPAWN_CLEARANCE_M,
    };
    const blocked = field.some((o) => satOverlap(spawn, body(o)));
    if (blocked) {
      if (!pl.blocked) emit(world, 'blocked', spawn.x, pl.id);
      pl.blocked = true;
      continue;
    }
    pl.blocked = false;
    wants[pl.id] = true; // open the doors for the exiting tank
    if (world.gates[pl.id].open < 1) continue;
    t.status = 'field';
    t.deployRequested = false;
    t.x = spawn.x;
    t.y = spawn.y;
    t.heading = spawn.h;
    t.speed = C.kmhToMs(C.SPEED_STEP_KMH);
    t.cmdSpeedKmh = C.SPEED_STEP_KMH;
    t.turn = 0;
    t.cmdTurnDeg = 0;
    t.contacts = [];
    field.push(t);
  }
}

function updateShells(world, dt) {
  const speed = C.SHELL_RANGE_M / C.SHELL_FLIGHT_TIME_S;
  const L = C.FIELD_LENGTH_M;
  const keep = [];
  for (const s of world.shells) {
    const stepLen = Math.min(speed * dt, C.SHELL_RANGE_M - s.dist);
    let x1 = s.x + s.dx * stepLen;
    let y1 = s.y + s.dy * stepLen;

    // Crossing a gate wall: only passes through the currently open part of the doors.
    let stopped = false;
    for (const [wallX, owner] of [[0, 0], [L, 1]]) {
      const crosses = owner === 0 ? s.x >= 0 && x1 < 0 : s.x <= L && x1 > L;
      if (!crosses) continue;
      const k = (wallX - s.x) / (x1 - s.x);
      const yc = s.y + k * (y1 - s.y);
      const half = (world.gates[owner].open * C.GATE_WIDTH_M) / 2;
      if (half <= 0 || Math.abs(yc - C.GATE_CENTER_Y_M) > half) {
        x1 = wallX;
        y1 = yc;
        stopped = true;
      }
    }

    let hitT = null;
    let hitTank = null;
    let hitObstacle = false;
    for (const t of world.tanks) {
      if (t.status === 'dead') continue; // field tanks and tanks visible inside open hangars
      const hit = segmentVsObb(s.x, s.y, x1, y1, body(t));
      if (hit != null && (hitT == null || hit < hitT)) {
        hitT = hit;
        hitTank = t;
        hitObstacle = false;
      }
    }
    if (world.obstacles) {
      for (const ob of world.obstacles) {
        const hit = segmentVsObb(s.x, s.y, x1, y1, ob);
        if (hit != null && (hitT == null || hit < hitT)) {
          hitT = hit;
          hitTank = null;
          hitObstacle = true;
        }
      }
    }
    if (hitTank) {
      kill(world, hitTank, s.owner, false);
      continue;
    }
    if (hitObstacle) {
      const hx = s.x + s.dx * (stepLen * hitT);
      const hy = s.y + s.dy * (stepLen * hitT);
      world.explosions.push({ x: hx, y: hy, t: 0, big: false });
      emit(world, 'boom', hx, s.owner);
      continue;
    }
    if (stopped) continue; // hit a closed door / wall
    s.x = x1;
    s.y = y1;
    s.dist += stepLen;
    if (s.dist >= C.SHELL_RANGE_M - 1e-6) continue;
    const inField = s.x >= 0 && s.x <= L && s.y >= 0 && s.y <= C.FIELD_WIDTH_M;
    const inHangar =
      ((s.x < 0 && s.x >= -C.HANGAR_DEPTH_M) || (s.x > L && s.x <= L + C.HANGAR_DEPTH_M)) &&
      Math.abs(s.y - C.GATE_CENTER_Y_M) <= C.HANGAR_HALF_WIDTH_M;
    if (!inField && !inHangar) continue;
    keep.push(s);
  }
  world.shells = keep;
}

function updateMines(world, dt) {
  const field = fieldTanks(world);
  const keep = [];
  for (const m of world.mines) {
    m.armT = Math.max(0, m.armT - dt);
    let triggered = false;
    if (m.armT <= 0) {
      for (const t of field) {
        if (t.status === 'field' && circleTouchesObb(m.x, m.y, C.MINE_TRIGGER_RADIUS_M, body(t))) {
          kill(world, t, null, true);
          triggered = true;
        }
      }
    }
    if (triggered) world.explosions.push({ x: m.x, y: m.y, t: 0, big: true });
    else keep.push(m);
  }
  world.mines = keep;
}

function updateTimed(world, dt) {
  world.smokes.forEach((s) => (s.t += dt));
  world.smokes = world.smokes.filter((s) => s.t < C.SMOKE_LIFETIME_S);
  world.explosions.forEach((e) => (e.t += dt));
  world.explosions = world.explosions.filter((e) => e.t < C.EXPLOSION_DURATION_S);
}

function compactHangars(world) {
  for (const owner of [0, 1]) {
    for (let i = 0; i < C.HANGAR_SLOTS_PER_ROW; i++) {
      for (let row = 1; row < C.HANGAR_ROWS; row++) {
        const t = hangarTankAt(world, owner, row, i);
        if (t && !hangarTankAt(world, owner, row - 1, i)) placeInHangar(t, row - 1, i);
      }
    }
  }
}

function updatePits(world) {
  if (!world.pits || world.pits.length === 0) return;
  const field = fieldTanks(world);
  for (const t of field) {
    if (t.status !== 'field') continue;
    for (const pit of world.pits) {
      if (tankPitOverlap(t, pit) >= C.PIT_DROP_OVERLAP_FRACTION) {
        kill(world, t, null, false, 'pit');
        break;
      }
    }
  }
}

/** held: {windowTurn: [-1|0|1, -1|0|1]} */
export function step(world, dt, held) {
  if (world.over) return;
  world.time += dt;

  for (const pl of world.players) {
    pl.windowReload = Math.max(0, pl.windowReload - dt);
    pl.msgT = Math.max(0, pl.msgT - dt);
    if (pl.view === 'window') {
      const lim = C.degToRad(C.WINDOW_MAX_YAW_DEG);
      pl.windowYaw = clamp(pl.windowYaw + (held.windowTurn[pl.id] || 0) * C.degToRad(C.WINDOW_YAW_RATE_DEG_S) * dt, -lim, lim);
    }
  }

  const field = fieldTanks(world);
  for (const t of field) {
    t.reload = Math.max(0, t.reload - dt);
    moveTank(t, dt);
  }
  resolveCollisions(world);
  handleGateEntry(world);
  updatePits(world);
  const wants = gateWants(world);
  tryDeploys(world, wants);
  updateGates(world, dt, wants);
  updateShells(world, dt);
  updateMines(world, dt);
  updateTimed(world, dt);
  compactHangars(world);

  const l0 = world.players[0].lost >= C.TANKS_PER_PLAYER;
  const l1 = world.players[1].lost >= C.TANKS_PER_PLAYER;
  if (l0 || l1) {
    world.over = true;
    world.winner = l0 && l1 ? 'draw' : l0 ? 1 : 0;
  }
}

export function syncWorldTerrain(world, options) {
  if (!world) return;
  if (options.obstacles && (!world.obstacles || world.obstacles.length === 0)) {
    world.obstacles = generateObstacles();
  } else if (!options.obstacles) {
    world.obstacles = [];
  }
  if (options.pits && (!world.pits || world.pits.length === 0)) {
    world.pits = generatePits(world.obstacles || []);
  } else if (!options.pits) {
    world.pits = [];
  }
}

