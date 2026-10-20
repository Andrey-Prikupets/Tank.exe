import * as C from '../constants.js';
import { toLocal } from './geometry.js';

export function generateObstacles() {
  const obstacles = [];
  const targetCount = 7;
  let attempts = 0;

  const lengths = [12, 14, 16];
  const widths = [8, 10, 12];
  const angles = [0, Math.PI / 2, Math.PI / 6, -Math.PI / 6];

  while (obstacles.length < targetCount && attempts < 200) {
    attempts++;
    const l = lengths[Math.floor(Math.random() * lengths.length)];
    const w = widths[Math.floor(Math.random() * widths.length)];
    const h = angles[Math.floor(Math.random() * angles.length)];
    const x = 55 + Math.random() * (C.FIELD_LENGTH_M - 110); // 55 to 195
    const y = 18 + Math.random() * (C.FIELD_WIDTH_M - 36);  // 18 to 82

    // Avoid gate approaches
    if ((x < 72 || x > 178) && Math.abs(y - C.GATE_CENTER_Y_M) < 16) continue;

    // Check clearance from other obstacles
    const radius = Math.hypot(l, w) / 2;
    let ok = true;
    for (const ob of obstacles) {
      const otherRadius = Math.hypot(ob.l, ob.w) / 2;
      if (Math.hypot(x - ob.x, y - ob.y) < radius + otherRadius + 10) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    obstacles.push({
      id: obstacles.length + 1,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      h,
      l,
      w,
      height: C.OBSTACLE_HEIGHT_M,
    });
  }

  return obstacles;
}

export function generatePits(existingObstacles = []) {
  const pits = [];
  const targetCount = 5;
  let attempts = 0;

  const lengths = [14, 16, 18, 20];
  const widths = [6, 7, 8];
  const angles = [0, Math.PI / 2];

  while (pits.length < targetCount && attempts < 200) {
    attempts++;
    const l = lengths[Math.floor(Math.random() * lengths.length)];
    const w = widths[Math.floor(Math.random() * widths.length)];
    const h = angles[Math.floor(Math.random() * angles.length)];
    const x = 60 + Math.random() * (C.FIELD_LENGTH_M - 120); // 60 to 190
    const y = 18 + Math.random() * (C.FIELD_WIDTH_M - 36);  // 18 to 82

    // Avoid gate approaches
    if ((x < 75 || x > 175) && Math.abs(y - C.GATE_CENTER_Y_M) < 16) continue;

    // Avoid blocking the exact center choke point
    if (Math.abs(x - C.FIELD_LENGTH_M / 2) < 10 && Math.abs(y - C.GATE_CENTER_Y_M) < 10) continue;

    const radius = Math.hypot(l, w) / 2;
    let ok = true;

    // Check clearance from obstacles
    for (const ob of existingObstacles) {
      const obRadius = Math.hypot(ob.l, ob.w) / 2;
      if (Math.hypot(x - ob.x, y - ob.y) < radius + obRadius + 9) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    // Check clearance from other pits
    for (const pit of pits) {
      const pitRadius = Math.hypot(pit.l, pit.w) / 2;
      if (Math.hypot(x - pit.x, y - pit.y) < radius + pitRadius + 11) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    pits.push({
      id: pits.length + 1,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      h,
      l,
      w,
    });
  }

  return pits;
}

/**
 * Calculates fraction of tank area overlapping inside a pit.
 * Returns value between 0.0 and 1.0.
 */
export function tankPitOverlap(tank, pit) {
  let inside = 0;
  const nx = 5;
  const ny = 5;
  const total = nx * ny;
  const c = Math.cos(tank.heading);
  const s = Math.sin(tank.heading);
  const hl = C.TANK_LENGTH_M / 2;
  const hw = C.TANK_WIDTH_M / 2;

  for (let ix = 0; ix < nx; ix++) {
    const fx = -hl + (ix / (nx - 1)) * 2 * hl;
    for (let iy = 0; iy < ny; iy++) {
      const fy = -hw + (iy / (ny - 1)) * 2 * hw;
      const px = tank.x + c * fx - s * fy;
      const py = tank.y + s * fx + c * fy;
      const [lx, ly] = toLocal(pit, px, py);
      if (Math.abs(lx) <= pit.l / 2 && Math.abs(ly) <= pit.w / 2) {
        inside++;
      }
    }
  }

  return inside / total;
}
