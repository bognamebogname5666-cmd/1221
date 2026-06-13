/**
 * NEXUS BLOCKS — GameLoop
 * ─────────────────────────────────────────────────────────────────────────────
 * Implements a fixed-timestep requestAnimationFrame game loop.
 *
 * Architecture overview:
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  rAF fires every ~16.67 ms at 60 Hz display                         │
 *   │                                                                      │
 *   │  rawDelta = timestamp − lastTime                                     │
 *   │  delta    = min(rawDelta, MAX_DELTA)   ← spiral-of-death guard       │
 *   │  accumulator += delta                                                │
 *   │                                                                      │
 *   │  while (accumulator ≥ TICK_MS && updateCount < MAX_UPDATES) {        │
 *   │    update(TICK_MS)          ← deterministic, always 16.67 ms        │
 *   │    accumulator -= TICK_MS                                            │
 *   │  }                                                                   │
 *   │                                                                      │
 *   │  alpha = accumulator / TICK_MS   ← interpolation factor [0..1]      │
 *   │  render(alpha)                   ← smooth sub-tick rendering         │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Key properties:
 *   • update() receives a CONSTANT dt regardless of frame rate — physics,
 *     timers and game logic are deterministic across any display Hz.
 *   • render() receives an interpolation factor `alpha` so renderers can
 *     smoothly blend between the previous and current simulation state for
 *     sub-tick visual accuracy at high refresh rates (120/144 Hz).
 *   • MAX_DELTA clamps huge gaps (tab switching, debugger breakpoints) to
 *     prevent the simulation from trying to catch up seconds of lag.
 *   • MAX_UPDATES per frame prevents cascading lag spirals when the machine
 *     is truly too slow: we discard excess accumulated time gracefully.
 *
 * Usage:
 *   const loop = new GameLoop(
 *     (dt)    => world.update(dt),    // dt is always TICK_MS (~16.67)
 *     (alpha) => world.render(alpha)  // alpha in [0, 1]
 *   );
 *   loop.start();
 *   // later:
 *   loop.pause();
 *   loop.resume();
 *   loop.stop();
 */

'use strict';

class GameLoop {
  /**
   * @param {function(number): void} updateFn
   *   Called with the fixed simulation step (ms) each tick.
   *
   * @param {function(number): void} renderFn
   *   Called once per frame with an interpolation factor in [0, 1].
   *
   * @param {object}  [options]
   * @param {number}  [options.tickRate=60]    Simulation ticks per second.
   * @param {number}  [options.maxDelta=250]   Max delta (ms) before clamping.
   * @param {number}  [options.maxUpdates=5]   Max update calls per frame.
   * @param {EventBus} [options.eventBus=null] Optional bus to emit loop events.
   */
  constructor(updateFn, renderFn, options = {}) {
    if (typeof updateFn !== 'function') throw new TypeError('GameLoop: updateFn must be a function');
    if (typeof renderFn !== 'function') throw new TypeError('GameLoop: renderFn must be a function');

    /** @private */ this._update = updateFn;
    /** @private */ this._render = renderFn;
    /** @private */ this._bus    = options.eventBus ?? null;

    // ── Configuration (public, readable; change before start()) ────────────

    /** Simulation tick rate in Hz. */
    this.tickRate   = options.tickRate   ?? 60;

    /** Fixed simulation step in milliseconds (derived from tickRate). */
    this.TICK_MS    = 1000 / this.tickRate;

    /** Maximum raw delta before clamping — prevents spiral-of-death. */
    this.MAX_DELTA  = options.maxDelta   ?? 250;

    /** Maximum update() calls per frame — lag safety valve. */
    this.MAX_UPDATES = options.maxUpdates ?? 5;

    // ── Runtime State ───────────────────────────────────────────────────────

    /** True once start() is called, false after stop(). */
    this.running    = false;

    /** True between pause() and resume() calls. */
    this.paused     = false;

    /** @private Accumulated simulation time not yet consumed by update(). */
    this._accumulator = 0;

    /** @private Timestamp of the previous rAF frame. 0 = "not initialised". */
    this._lastTime  = 0;

    /** @private rAF handle for cancellation. */
    this._rafId     = null;

    // ── Performance Statistics ──────────────────────────────────────────────

    /** @private FPS counter accumulator. */
    this._fpsFrameCount = 0;

    /** @private Elapsed time in the current FPS measurement window (ms). */
    this._fpsTimer = 0;

    /**
     * Live performance stats — updated once per second.
     * @type {{ fps: number, frameTime: number, updateCount: number }}
     */
    this.stats = { fps: 0, frameTime: 0, updateCount: 0 };

    // Bind the loop method once to avoid allocating a new closure each frame
    this._boundLoop = this._loop.bind(this);
  }

  // ── Public Lifecycle API ───────────────────────────────────────────────────

  /**
   * Starts the game loop from a clean state.
   * Safe to call multiple times — a no-op if already running.
   */
  start() {
    if (this.running) return;

    this.running      = true;
    this.paused       = false;
    this._accumulator = 0;
    this._lastTime    = 0;   // Will be initialised on the first rAF callback

    this._rafId = requestAnimationFrame(this._boundLoop);
    this._bus?.emit('loop:started');
  }

  /**
   * Pauses simulation updates and rendering.
   *
   * The rAF is NOT cancelled — the loop stays alive so that the pause overlay
   * can animate and input events keep working. The accumulator is drained so
   * that a burst of catch-up ticks doesn't fire on resume.
   */
  pause() {
    if (!this.running || this.paused) return;

    this.paused       = true;
    this._accumulator = 0;   // Discard pending ticks so resume starts clean

    this._bus?.emit('loop:paused');
  }

  /**
   * Resumes a paused loop.
   *
   * Sets _lastTime to 0 so the next rAF callback re-initialises the timestamp
   * reference, preventing the elapsed pause duration from being injected as
   * simulation time.
   */
  resume() {
    if (!this.running || !this.paused) return;

    this.paused       = false;
    this._lastTime    = 0;   // Force timestamp re-sync on next frame
    this._accumulator = 0;

    this._bus?.emit('loop:resumed');
  }

  /**
   * Stops the loop permanently and cancels the pending rAF.
   * Call start() to restart from scratch.
   */
  stop() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    this.running      = false;
    this.paused       = false;
    this._accumulator = 0;
    this._lastTime    = 0;

    this._bus?.emit('loop:stopped');
  }

  // ── Core Loop Body ─────────────────────────────────────────────────────────

  /**
   * The inner loop body — called by requestAnimationFrame every display frame.
   *
   * Steps:
   *   1. On the first frame after start()/resume(), record the timestamp and
   *      return immediately (no delta yet, avoids a huge first-frame spike).
   *   2. Compute raw delta; clamp to MAX_DELTA.
   *   3. If paused, skip update/render but keep rAF alive.
   *   4. Accumulate delta; run as many fixed update ticks as available.
   *   5. Discard excess accumulated time if MAX_UPDATES was hit.
   *   6. Compute interpolation alpha and call render(alpha).
   *   7. Update performance stats.
   *   8. Schedule the next frame.
   *
   * @param {DOMHighResTimeStamp} timestamp — provided by the browser
   */
  _loop(timestamp) {
    // ── 1. First-frame initialisation ──────────────────────────────────────
    if (this._lastTime === 0) {
      this._lastTime = timestamp;
      this._rafId    = requestAnimationFrame(this._boundLoop);
      return;
    }

    // ── 2. Delta calculation ────────────────────────────────────────────────
    const rawDelta = timestamp - this._lastTime;
    this._lastTime = timestamp;

    // ── 3. Pause guard ──────────────────────────────────────────────────────
    if (this.paused) {
      this._rafId = requestAnimationFrame(this._boundLoop);
      return;
    }

    // Clamp: if the tab was hidden or the debugger paused execution,
    // rawDelta might be several seconds. We simulate at most MAX_DELTA ms
    // of "real" game time to prevent the simulation from exploding.
    const delta = Math.min(rawDelta, this.MAX_DELTA);
    this._accumulator += delta;

    // ── 4. Fixed-step simulation ticks ─────────────────────────────────────
    let updateCount = 0;
    while (this._accumulator >= this.TICK_MS && updateCount < this.MAX_UPDATES) {
      this._update(this.TICK_MS);
      this._accumulator -= this.TICK_MS;
      updateCount++;
    }

    // ── 5. Discard excess accumulated time on lag ───────────────────────────
    // If MAX_UPDATES was hit while we're still behind, we've already called
    // update MAX_UPDATES times this frame — discard the remainder so the
    // loop doesn't perpetually try to catch up on the next frames.
    if (updateCount === this.MAX_UPDATES && this._accumulator > this.TICK_MS) {
      this._accumulator = this._accumulator % this.TICK_MS;
    }

    // ── 6. Interpolated render ──────────────────────────────────────────────
    // alpha = fraction of the current tick that has elapsed.
    // A renderer interpolating between previousState and currentState should
    // display: previousState + (currentState − previousState) * alpha
    // for buttery smooth motion at any display refresh rate.
    const alpha = this._accumulator / this.TICK_MS;
    this._render(alpha);

    // ── 7. Performance stats (updated once per second) ──────────────────────
    this.stats.frameTime   = rawDelta;
    this.stats.updateCount = updateCount;

    this._fpsFrameCount++;
    this._fpsTimer += rawDelta;
    if (this._fpsTimer >= 1000) {
      this.stats.fps      = this._fpsFrameCount;
      this._fpsFrameCount = 0;
      this._fpsTimer     -= 1000;
      this._bus?.emit('loop:stats', { ...this.stats });
    }

    // ── 8. Schedule next frame ──────────────────────────────────────────────
    this._rafId = requestAnimationFrame(this._boundLoop);
  }

  // ── Computed Properties ────────────────────────────────────────────────────

  /**
   * True when the loop is ticking (running AND not paused).
   * @returns {boolean}
   */
  get isActive() {
    return this.running && !this.paused;
  }

  /**
   * Current FPS reading (updated once per second).
   * @returns {number}
   */
  get fps() {
    return this.stats.fps;
  }

  /**
   * Duration of the most recently completed frame in milliseconds.
   * @returns {number}
   */
  get frameTime() {
    return this.stats.frameTime;
  }
}

// CommonJS / browser-global dual export
if (typeof module !== 'undefined') module.exports = { GameLoop };
