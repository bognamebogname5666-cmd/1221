/**
 * NEXUS BLOCKS — MathUtils
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure math helpers used across the game engine, particle system, and UI.
 * No side-effects; all functions are stateless.
 */

'use strict';

const MathUtils = Object.freeze({

  // ── Numeric Clamps & Maps ─────────────────────────────────────────────────

  /** Clamps value to [min, max]. */
  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  },

  /** Linear interpolation between a and b by factor t in [0,1]. */
  lerp(a, b, t) {
    return a + (b - a) * t;
  },

  /** Inverse lerp: returns the t in [0,1] such that lerp(a,b,t) === value. */
  inverseLerp(a, b, value) {
    return a === b ? 0 : (value - a) / (b - a);
  },

  /** Re-maps value from one range to another. */
  remap(value, inMin, inMax, outMin, outMax) {
    const t = MathUtils.inverseLerp(inMin, inMax, value);
    return MathUtils.lerp(outMin, outMax, t);
  },

  /** Returns the nearest grid-snapped position given a cell size. */
  snapToGrid(value, cellSize) {
    return Math.round(value / cellSize) * cellSize;
  },

  // ── Angles & Vectors ──────────────────────────────────────────────────────

  /** Degrees to radians. */
  degToRad(deg) { return deg * (Math.PI / 180); },

  /** Radians to degrees. */
  radToDeg(rad) { return rad * (180 / Math.PI); },

  /** 2D Euclidean distance between two {x,y} points. */
  dist(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  },

  /** Returns the angle in radians from point a to point b. */
  angleTo(a, b) {
    return Math.atan2(b.y - a.y, b.x - a.x);
  },

  /**
   * Returns an {x, y} unit vector pointing from a to b.
   * Returns {x:0, y:0} when a === b.
   */
  dirTo(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    return len === 0 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
  },

  // ── Randomness ────────────────────────────────────────────────────────────

  /** Returns a random float in [min, max). */
  randomFloat(min, max) {
    return min + Math.random() * (max - min);
  },

  /** Returns a random integer in [min, max] (inclusive). */
  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  /** Returns true with the given probability [0..1]. */
  chance(probability) {
    return Math.random() < probability;
  },

  /** Randomly picks an element from an array. */
  pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  },

  // ── Geometry ──────────────────────────────────────────────────────────────

  /**
   * Returns true when point p is inside an axis-aligned rectangle.
   * @param {{ x:number, y:number }} p
   * @param {{ x:number, y:number, w:number, h:number }} rect
   */
  pointInRect(p, rect) {
    return p.x >= rect.x && p.x <= rect.x + rect.w &&
           p.y >= rect.y && p.y <= rect.y + rect.h;
  },

  /**
   * Returns true when two axis-aligned rectangles overlap.
   * @param {{ x, y, w, h }} a
   * @param {{ x, y, w, h }} b
   */
  rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  },

  // ── Misc ──────────────────────────────────────────────────────────────────

  /** Formats a score number with comma separators for display. */
  formatScore(n) {
    return n.toLocaleString('en-US');
  },

  /**
   * XP required to reach a given player level (1-based).
   * Formula from GDD: level * 100 + 50
   */
  xpForLevel(level) {
    return level * 100 + 50;
  },

  /**
   * Derives the player's current level from total accumulated XP.
   * @param {number} totalXp
   * @returns {{ level: number, xpIntoLevel: number, xpForNext: number }}
   */
  xpToLevel(totalXp) {
    let level = 1;
    let remaining = totalXp;
    while (true) {
      const required = MathUtils.xpForLevel(level);
      if (remaining < required) break;
      remaining -= required;
      level++;
      if (level >= 50) break;
    }
    const xpForNext = MathUtils.xpForLevel(level);
    return { level, xpIntoLevel: remaining, xpForNext };
  },
});

if (typeof module !== 'undefined') module.exports = { MathUtils };
