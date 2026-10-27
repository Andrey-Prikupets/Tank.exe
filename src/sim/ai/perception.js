import * as C from '../../constants.js';
import { segmentVsObb } from '../geometry.js';

/** Determines if line segment intersects a circle of radius r centered at (cx, cy). */
export function segmentIntersectsCircle(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return Math.hypot(x1 - cx, y1 - cy) <= r;
  }
  const t = Math.max(0, Math.min(1, ((cx - x1) * dx + (cy - y1) * dy) / lenSq));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(px - cx, py - cy) <= r;
}

/** Determines if line of sight is obstructed by any active smoke cloud. */
export function isLineOfSightBlockedBySmoke(world, x1, y1, x2, y2) {
  if (!world.smokes || world.smokes.length === 0) return false;
  const dTotal = Math.hypot(x2 - x1, y2 - y1);

  for (const s of world.smokes) {
    if (s.t >= C.SMOKE_LIFETIME_S) continue;

    const d1 = Math.hypot(x1 - s.x, y1 - s.y);
    const d2 = Math.hypot(x2 - s.x, y2 - s.y);

    // If observer or target is inside the smoke cloud: visibility drops to ~2m
    if (d1 < C.SMOKE_RADIUS_M || d2 < C.SMOKE_RADIUS_M) {
      if (dTotal > C.SMOKE_VISIBLE_DISTANCE_M) return true;
    }

    // Intervening smoke cloud crossing the ray
    if (segmentIntersectsCircle(x1, y1, x2, y2, s.x, s.y, C.SMOKE_RADIUS_M)) {
      if (dTotal > C.SMOKE_VISIBLE_DISTANCE_M) return true;
    }
  }
  return false;
}

/** Predicts enemy position and blind-fire probability from last seen state. */
export function getPredictedEnemyState(tracker, e, simTime, levelName = 'MEDIUM') {
  if (!tracker) return null;
  const track = tracker.get(e.id);
  if (!track) return null;

  const timeSinceSeen = simTime - track.lastSeenTime;
  if (timeSinceSeen > C.AI_SMOKE_MAX_TRACK_AGE_S) return null;

  let predX = track.x;
  let predY = track.y;
  let hitProb = 0;

  if (track.isStationary) {
    // Stationary target: position unchanged, high hit probability!
    predX = track.x;
    predY = track.y;
    hitProb = Math.max(
      0.2,
      C.AI_SMOKE_INITIAL_CONFIDENCE_STATIONARY - timeSinceSeen * C.AI_SMOKE_STATIONARY_DECAY_PER_S,
    );
  } else {
    // Moving target: dead-reckoning extrapolation
    predX = track.x + Math.cos(track.heading) * track.speed * timeSinceSeen;
    predY = track.y + Math.sin(track.heading) * track.speed * timeSinceSeen;
    predX = Math.max(4, Math.min(C.FIELD_LENGTH_M - 4, predX));
    predY = Math.max(4, Math.min(C.FIELD_WIDTH_M - 4, predY));

    // Each new second decreases estimate quality and hit probability
    hitProb = Math.max(
      0,
      C.AI_SMOKE_INITIAL_CONFIDENCE_MOVING - timeSinceSeen * C.AI_SMOKE_PREDICT_DECAY_PER_S,
    );
  }

  const minProb =
    levelName === 'HARD'
      ? C.AI_SMOKE_BLIND_FIRE_MIN_PROB_HARD
      : levelName === 'EASY'
        ? C.AI_SMOKE_BLIND_FIRE_MIN_PROB_EASY
        : C.AI_SMOKE_BLIND_FIRE_MIN_PROB_MEDIUM;

  const canBlindFire = hitProb >= minProb;

  return {
    predX,
    predY,
    speed: track.isStationary ? 0 : track.speed,
    heading: track.heading,
    isStationary: track.isStationary,
    timeSinceSeen,
    hitProb,
    canBlindFire,
  };
}

export function isLineOfFireBlocked(world, owner, startX, startY, targetX, targetY, myTankId) {
  const dx = targetX - startX;
  const dy = targetY - startY;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return false;
  const nx = dx / dist;
  const ny = dy / dist;

  // 1. Check obstacles (buildings block shells)
  if (world.obstacles) {
    for (const ob of world.obstacles) {
      const hit = segmentVsObb(startX, startY, targetX, targetY, ob);
      if (hit != null && hit > 0.01 && hit < 0.99) {
        return true; // blocked by building!
      }
    }
  }

  // 2. Check friendly tanks
  for (const t of world.tanks) {
    if (t.owner === owner && t.status === 'field' && t.id !== myTankId) {
      const fx = t.x - startX;
      const fy = t.y - startY;
      const proj = fx * nx + fy * ny;
      if (proj > 2.0 && proj < dist - 2.0) {
        const perp = Math.abs(fx * ny - fy * nx);
        if (perp < C.TANK_WIDTH_M / 2 + 1.2) {
          return true; // friendly tank would be hit!
        }
      }
    }
  }
  return false;
}

/** Updates visual intelligence memory of enemy units, recording last known states when visible. */
export function updateEnemyTracking(ctl, world, myTank, enemyField) {
  if (!myTank) return;
  const activeEnemyIds = new Set(enemyField.map((e) => e.id));

  // Remove dead enemies or enemies not on field
  for (const id of ctl.enemyTracker.keys()) {
    if (!activeEnemyIds.has(id)) {
      ctl.enemyTracker.delete(id);
    }
  }

  for (const e of enemyField) {
    const smokeBlocked = isLineOfSightBlockedBySmoke(world, myTank.x, myTank.y, e.x, e.y);
    const obsBlocked = isLineOfFireBlocked(
      world,
      ctl.owner,
      myTank.x,
      myTank.y,
      e.x,
      e.y,
      myTank.id,
    );

    if (!smokeBlocked && !obsBlocked) {
      ctl.enemyTracker.set(e.id, {
        lastSeenTime: ctl.simTime,
        x: e.x,
        y: e.y,
        speed: e.speed,
        heading: e.heading,
        isStationary: Math.abs(e.speed) < 0.35,
      });
    }
  }
}