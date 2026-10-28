import * as C from '../../constants.js';

export const PROFILES = {
  EASY: {
    tickInterval: 0.16,      // ~160ms decision tick
    coordInterval: 3.5,      // coordinates brigade tanks every 3.5s
    aimTolerance: 0.12,      // ~7 deg
    fireTolerance: 0.18,     // ~10 deg
    leadFactor: 0.0,         // direct aiming, no lead
    maxSpeedKmh: 18,
    maxFireDist: 16,         // holds fire until within 16m
    standoffDist: 12,        // stops advancing at 12m
    minDist: 8,              // reverses if closer than 8m to avoid collision
    useSmoke: 0.2,
    useMines: 0.2,
    multiTank: true,
    rearm: true,             // returns to hangar to reload when shells run out
  },
  MEDIUM: {
    tickInterval: 0.10,      // ~100ms decision tick
    coordInterval: 2.0,      // coordinates brigade tanks every 2.0s
    aimTolerance: 0.08,      // ~4.5 deg
    fireTolerance: 0.14,     // ~8 deg
    leadFactor: 0.5,         // partial lead
    maxSpeedKmh: 36,
    maxFireDist: 22,         // holds fire until within 22m
    standoffDist: 15,        // stops advancing at 15m
    minDist: 9,              // reverses if closer than 9m
    useSmoke: 0.6,
    useMines: 0.6,
    multiTank: true,
    rearm: true,
  },
  HARD: {
    tickInterval: 0.05,      // ~50ms decision tick
    coordInterval: 1.2,      // fast multi-tank coordination
    aimTolerance: 0.05,      // ~3 deg
    fireTolerance: 0.10,     // ~5.7 deg
    leadFactor: 1.0,         // full predictive lead
    maxSpeedKmh: 36,
    maxFireDist: C.SHELL_RANGE_M, // 32m maximum physical shell reach
    standoffDist: 18,        // stops advancing at 18m
    minDist: 10,             // reverses if closer than 10m
    useSmoke: 0.9,
    useMines: 0.9,
    multiTank: true,
    rearm: true,
  },
};