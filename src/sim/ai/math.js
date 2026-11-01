import * as C from '../../constants.js';
export { normalizeAngle } from '../geometry.js';

/**
 * Resolves the relative randomness / noise amplitude for a difficulty level or profile.
 * - EASY: high randomness (~0.32) for vague, distorted, occasionally lagging decisions
 * - MEDIUM: moderate randomness (~0.14)
 * - HARD: low randomness (~0.03) for high precision while still breaking symmetric loops
 */
export function resolveNoiseFactor(profileOrLevel) {
  if (typeof profileOrLevel === 'number' && Number.isFinite(profileOrLevel)) {
    return Math.max(0, profileOrLevel);
  }
  if (typeof profileOrLevel === 'string') {
    const u = profileOrLevel.toUpperCase();
    if (u === 'EASY') return C.AI_NOISE_FACTOR_EASY;
    if (u === 'HARD') return C.AI_NOISE_FACTOR_HARD;
    return C.AI_NOISE_FACTOR_MEDIUM;
  }
  if (profileOrLevel && typeof profileOrLevel === 'object') {
    if (typeof profileOrLevel.noiseFactor === 'number') return profileOrLevel.noiseFactor;
    if (typeof profileOrLevel.profile?.noiseFactor === 'number') return profileOrLevel.profile.noiseFactor;
    if (typeof profileOrLevel.level === 'string') return resolveNoiseFactor(profileOrLevel.level);
  }
  return C.AI_NOISE_FACTOR_HARD;
}

/**
 * Generic threshold fuzzing function for AI numeric comparisons (distance, angle, speed, time).
 * Perturbs `value` by uniform relative noise in `[-factor, +factor]` scaled by difficulty level
 * while strictly respecting domain boundaries (e.g., positive times/distances/angles never become
 * negative or zero; negative local offsets never flip positive; explicit [min, max] bounds are clamped).
 */
export function fuzz(value, profileOrLevel, min = undefined, max = undefined) {
  if (!Number.isFinite(value) || value === 0) return value;
  const factor = resolveNoiseFactor(profileOrLevel);
  const delta = (Math.random() * 2 - 1) * factor;
  const raw = value * (1 + delta);

  if (value > 0) {
    const lo = min !== undefined ? Math.max(0, min) : value * 0.1;
    const hi = max !== undefined ? max : Infinity;
    return Math.max(lo, Math.min(hi, raw));
  }

  // value < 0 (e.g., rear wake offset -2.0 or -24.0)
  const lo = min !== undefined ? min : -Infinity;
  const hi = max !== undefined ? Math.min(0, max) : value * 0.1;
  return Math.max(lo, Math.min(hi, raw));
}
