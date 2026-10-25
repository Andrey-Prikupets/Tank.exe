// Oriented-box (OBB) and segment helpers. Bodies: {x, y, h (heading, rad), l, w}.

export function obbCorners(b) {
  const c = Math.cos(b.h);
  const s = Math.sin(b.h);
  const hl = b.l / 2;
  const hw = b.w / 2;
  const fx = c * hl;
  const fy = s * hl;
  const rx = -s * hw;
  const ry = c * hw;
  return [
    [b.x + fx + rx, b.y + fy + ry],
    [b.x + fx - rx, b.y + fy - ry],
    [b.x - fx - rx, b.y - fy - ry],
    [b.x - fx + rx, b.y - fy + ry],
  ];
}

function project(corners, ax, ay) {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of corners) {
    const d = x * ax + y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** SAT overlap. Returns {nx, ny, depth} with normal pointing from b to a, or null. */
export function satOverlap(a, b) {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes = [
    [Math.cos(a.h), Math.sin(a.h)],
    [-Math.sin(a.h), Math.cos(a.h)],
    [Math.cos(b.h), Math.sin(b.h)],
    [-Math.sin(b.h), Math.cos(b.h)],
  ];
  let best = null;
  for (const [ax, ay] of axes) {
    const [minA, maxA] = project(ca, ax, ay);
    const [minB, maxB] = project(cb, ax, ay);
    const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (overlap <= 0) return null;
    if (!best || overlap < best.depth) best = { nx: ax, ny: ay, depth: overlap };
  }
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  if (best.nx * dx + best.ny * dy < 0) {
    best.nx = -best.nx;
    best.ny = -best.ny;
  }
  return best;
}

export function toLocal(b, px, py) {
  const h = b.h != null ? b.h : (b.heading || 0);
  const c = Math.cos(h);
  const s = Math.sin(h);
  const dx = px - b.x;
  const dy = py - b.y;
  return [dx * c + dy * s, -dx * s + dy * c];
}

/** Segment vs OBB. Returns entry parameter t in [0,1] or null. */
export function segmentVsObb(x0, y0, x1, y1, b) {
  const [lx0, ly0] = toLocal(b, x0, y0);
  const [lx1, ly1] = toLocal(b, x1, y1);
  const hl = b.l / 2;
  const hw = b.w / 2;
  let tmin = 0;
  let tmax = 1;
  const slabs = [
    [lx0, lx1 - lx0, hl],
    [ly0, ly1 - ly0, hw],
  ];
  for (const [o, d, half] of slabs) {
    if (Math.abs(d) < 1e-9) {
      if (o < -half || o > half) return null;
    } else {
      let t1 = (-half - o) / d;
      let t2 = (half - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

export function circleTouchesObb(cx, cy, r, b) {
  const [lx, ly] = toLocal(b, cx, cy);
  const qx = Math.max(-b.l / 2, Math.min(b.l / 2, lx));
  const qy = Math.max(-b.w / 2, Math.min(b.w / 2, ly));
  return Math.hypot(lx - qx, ly - qy) <= r;
}
