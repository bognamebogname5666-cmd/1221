/**
 * NEXUS BLOCKS — AnimationUtils
 * ─────────────────────────────────────────────────────────────────────────────
 * Easing functions and lightweight tween helpers used by the particle system,
 * UI transitions, and the board renderer.
 *
 * All easing functions take t in [0, 1] and return a value in [0, 1]
 * (some overshoot slightly for bounce/back effects).
 *
 * The Tween class provides a simple single-value animator that integrates
 * with the game loop's fixed timestep.
 */

'use strict';

// ── Easing Functions ──────────────────────────────────────────────────────────

const Easing = Object.freeze({
  // ── Linear ────────────────────────────────────────────────────────────────
  linear : t => t,

  // ── Quad ──────────────────────────────────────────────────────────────────
  easeInQuad    : t => t * t,
  easeOutQuad   : t => t * (2 - t),
  easeInOutQuad : t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  // ── Cubic ─────────────────────────────────────────────────────────────────
  easeInCubic    : t => t * t * t,
  easeOutCubic   : t => (--t) * t * t + 1,
  easeInOutCubic : t => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  // ── Quart ─────────────────────────────────────────────────────────────────
  easeInQuart    : t => t * t * t * t,
  easeOutQuart   : t => 1 - (--t) * t * t * t,
  easeInOutQuart : t => t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t,

  // ── Exponential ───────────────────────────────────────────────────────────
  easeInExpo    : t => t === 0 ? 0 : Math.pow(2, 10 * t - 10),
  easeOutExpo   : t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  easeInOutExpo : t => {
    if (t === 0 || t === 1) return t;
    return t < 0.5
      ? Math.pow(2, 20 * t - 10) / 2
      : (2 - Math.pow(2, -20 * t + 10)) / 2;
  },

  // ── Back (slight overshoot) — used for piece-placement pop animation ──────
  // Matches the cubic-bezier(0.175, 0.885, 0.32, 1.275) in nexus_visuals.css
  easeOutBack : t => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeInOutBack : t => {
    const c1 = 1.70158;
    const c2 = c1 * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (2 * t - 2) + c2) + 2) / 2;
  },

  // ── Bounce ────────────────────────────────────────────────────────────────
  easeOutBounce : t => {
    const n1 = 7.5625, d1 = 2.75;
    if      (t < 1 / d1)       return n1 * t * t;
    else if (t < 2 / d1)       return n1 * (t -= 1.5 / d1)   * t + 0.75;
    else if (t < 2.5 / d1)     return n1 * (t -= 2.25 / d1)  * t + 0.9375;
    else                       return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  easeInBounce : t => 1 - Easing.easeOutBounce(1 - t),

  // ── Elastic ───────────────────────────────────────────────────────────────
  easeOutElastic : t => {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
});

// ── Tween ──────────────────────────────────────────────────────────────────────

/**
 * Lightweight single-value animator that integrates with the fixed-timestep
 * game loop. Drive it by calling tween.update(dt) each tick.
 *
 * Usage:
 *   const t = new Tween({ from: 0, to: 1, durationMs: 400, easing: Easing.easeOutBack });
 *   t.start();
 *   // In game-loop update:
 *   t.update(dt);
 *   ctx.globalAlpha = t.value;
 *   if (t.isDone) { ... }
 */
class Tween {
  /**
   * @param {object} options
   * @param {number}   options.from         Start value
   * @param {number}   options.to           End value
   * @param {number}   options.durationMs   Duration in milliseconds
   * @param {function} [options.easing]     Easing function; defaults to linear
   * @param {function} [options.onComplete] Called once when the tween finishes
   * @param {boolean}  [options.autoStart]  If true, starts immediately
   */
  constructor({ from, to, durationMs, easing = Easing.linear, onComplete = null, autoStart = false } = {}) {
    this.from        = from;
    this.to          = to;
    this.durationMs  = durationMs;
    this.easing      = easing;
    this.onComplete  = onComplete;

    this._elapsed    = 0;
    this._running    = false;
    this.value       = from;
    this.isDone      = false;

    if (autoStart) this.start();
  }

  /** Starts (or restarts) the tween from the beginning. */
  start() {
    this._elapsed = 0;
    this._running = true;
    this.isDone   = false;
    this.value    = this.from;
  }

  /** Stops the tween mid-animation without completing it. */
  stop() {
    this._running = false;
  }

  /** Skips to the end value immediately and fires onComplete. */
  complete() {
    this._elapsed = this.durationMs;
    this.value    = this.to;
    this.isDone   = true;
    this._running = false;
    this.onComplete?.();
  }

  /**
   * Advances the tween by dt milliseconds. Call this every game-loop tick.
   * @param {number} dt — fixed timestep in ms
   */
  update(dt) {
    if (!this._running || this.isDone) return;

    this._elapsed += dt;

    if (this._elapsed >= this.durationMs) {
      this.value    = this.to;
      this.isDone   = true;
      this._running = false;
      this.onComplete?.();
      return;
    }

    const t     = this._elapsed / this.durationMs;
    const eased = this.easing(t);
    this.value  = this.from + (this.to - this.from) * eased;
  }
}

// ── AnimationUtils namespace ───────────────────────────────────────────────────

const AnimationUtils = Object.freeze({
  Easing,
  Tween,

  /**
   * Factory: creates a Tween and starts it immediately.
   * @param {object} options  — same as Tween constructor
   * @returns {Tween}
   */
  tween(options) {
    return new Tween({ ...options, autoStart: true });
  },

  /**
   * Schedules a one-shot callback after a delay, driven by the game loop.
   * Returns a cancel function.
   *
   * @param {function} callback
   * @param {number}   delayMs
   * @returns {{ update(dt:number):void, cancel():void }}
   */
  delay(callback, delayMs) {
    let elapsed   = 0;
    let cancelled = false;

    return {
      update(dt) {
        if (cancelled) return;
        elapsed += dt;
        if (elapsed >= delayMs) {
          cancelled = true;
          callback();
        }
      },
      cancel() { cancelled = true; },
    };
  },

  /**
   * Applies the CSS animation class from nexus_visuals.css to a DOM element,
   * then removes it after the animation duration.
   *
   * @param {HTMLElement} el        — target element
   * @param {string}      className — e.g. 'anim-piece-place'
   * @param {number}      [ms=300]  — animation duration in ms
   */
  triggerCSSAnim(el, className, ms = 300) {
    if (!el) return;
    el.classList.remove(className);
    // Force reflow to restart the animation
    void el.offsetWidth;
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), ms);
  },
});

if (typeof module !== 'undefined') module.exports = { AnimationUtils, Easing, Tween };
